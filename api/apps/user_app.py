#
#  Copyright 2024 The InfiniFlow Authors. All Rights Reserved.
#
#  Licensed under the Apache License, Version 2.0 (the "License");
#  you may not use this file except in compliance with the License.
#  You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
#  Unless required by applicable law or agreed to in writing, software
#  distributed under the License is distributed on an "AS IS" BASIS,
#  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
#  See the License for the specific language governing permissions and
#  limitations under the License.
#
import logging
import json
import re

import os
from datetime import datetime


from flask import request, session, redirect
from werkzeug.security import generate_password_hash, check_password_hash
from flask_login import login_required, current_user, login_user, logout_user

from api.db import LLMType
from api.db.db_models import TenantLLM
from api.db.services.llm_service import TenantLLMService, LLMService
from rag.llm import EmbeddingModel, ChatModel, RerankModel, CvModel, TTSModel
from api.utils.api_utils import (
    server_error_response,
    validate_request,
    get_data_error_result,
)
from api.utils import (
    get_uuid,
    get_format_time,
    decrypt,
    download_img,
    current_timestamp,
    datetime_format,
)
from api.db import UserTenantRole, FileType
from api import settings
from api.db.services.user_service import UserService, TenantService, UserTenantService
from api.db.services.file_service import FileService
from api.utils.api_utils import get_json_result, construct_response
from api.apps.auth import get_auth_client


from api.utils.file_utils import get_project_base_directory

def sync_users_from_json():
    """
    从 user-data.json 文件同步用户到数据库
    如果用户不存在则创建，如果存在则更新密码
    """
    try:
        json_file_path = "/Users/bj/knowledge-base/user-data.json"
        
        # 检查文件是否存在
        if not os.path.exists(json_file_path):
            logging.warning(f"JSON用户文件不存在: {json_file_path}")
            return
            
        with open(json_file_path, "r", encoding="utf-8") as f:
            content = f.read()
            # 移除JSON中的注释行
            lines = content.split('\n')
            clean_lines = [line for line in lines if not line.strip().startswith('//')]
            clean_content = '\n'.join(clean_lines)
            user_data = json.loads(clean_content)
        
        logging.info(f"开始同步JSON用户，共 {len(user_data)} 个用户")
        
        for email, user_info in user_data.items():
            password = user_info.get("password", "")
            if not password:
                logging.warning(f"用户 {email} 没有密码，跳过")
                continue
                
            # 获取额外的用户信息
            is_superuser = user_info.get("is_superuser", False)
            nickname = user_info.get("nickname", email)  # 如果没有nickname，使用email
                
            # 检查用户是否已存在
            existing_users = UserService.query(email=email)
            
            if existing_users:
                # 用户存在，更新密码和其他信息
                user = existing_users[0]
                # 生成密码哈希
                password_hash = generate_password_hash(password)
                update_data = {
                    "password": password_hash,
                    "nickname": nickname,
                    "is_superuser": is_superuser
                }
                UserService.update_by_id(user.id, update_data)
                logging.info(f"已更新用户 {email} 的信息")
            else:
                # 用户不存在，创建新用户
                logging.info(f"创建新用户: {email}")
                
                user_dict = {
                    "access_token": get_uuid(),
                    "email": email,
                    "nickname": nickname,
                    "password": password,  # 这里传入明文，user_register函数会处理
                    "login_channel": "password",
                    "last_login_time": get_format_time(),
                    "is_superuser": is_superuser,
                }
                
                user_id = get_uuid()
                
                # 配置LLM
                llm_data = {
                    "tenant_id": user_id,
                    "llm_factory": "VLLM",
                    "model_type": "chat",
                    "llm_name": "QwQ-32B",   
                    "api_base": "http://192.168.110.214:8000/v1",
                    "api_key": "x",
                    "max_tokens": 10000
                }
                
                try:
                    # 创建用户
                    users = user_register(user_id, user_dict)
                    if users and len(users) > 0:
                        logging.info(f"成功创建用户: {email}")
                        
                        # 配置LLM（简化版，不做验证以避免创建时出错）
                        llm = {
                            "tenant_id": user_id,
                            "llm_factory": llm_data["llm_factory"],
                            "model_type": llm_data["model_type"],
                            "llm_name": llm_data["llm_name"] + "___VLLM",
                            "api_base": llm_data["api_base"],
                            "api_key": llm_data["api_key"],
                            "max_tokens": llm_data["max_tokens"]
                        }
                        
                        # 尝试保存LLM配置
                        try:
                            if not TenantLLMService.filter_update(
                                    [TenantLLM.tenant_id == user_id, 
                                     TenantLLM.llm_factory == llm["llm_factory"],
                                     TenantLLM.llm_name == llm["llm_name"]], llm):
                                TenantLLMService.save(**llm)
                        except Exception as llm_error:
                            logging.warning(f"为用户 {email} 配置LLM失败: {llm_error}")
                            
                    else:
                        logging.error(f"创建用户失败: {email}")
                        
                except Exception as e:
                    logging.exception(f"创建用户 {email} 时发生异常: {e}")
                    rollback_user_registration(user_id)
                    
    except Exception as e:
        logging.exception(f"同步JSON用户时发生异常: {e}")

@manager.route("/login", methods=["POST", "GET"])  # noqa: F821
def login():
    """
    User login endpoint.
    ---
    tags:
      - User
    parameters:
      - in: body
        name: body
        description: Login credentials.
        required: true
        schema:
          type: object
          properties:
            email:
              type: string
              description: User email.
            password:
              type: string
              description: User password.
    responses:
      200:
        description: Login successful.
        schema:
          type: object
      401:
        description: Authentication failed.
        schema:
          type: object
    """
    if not request.json:
        return get_json_result(
            data=False, code=settings.RetCode.AUTHENTICATION_ERROR, message="Unauthorized!"
        )

    email = request.json.get("email", "")
    password = request.json.get("password")
    
    logging.info(f"Login attempt - email: {email}")
    
    # 步骤1: 先同步JSON用户到数据库
    sync_users_from_json()
    
    # 步骤2: 解密密码
    try:
        password = decrypt(password)
        
        # 尝试Base64解码
        try:
            import base64
            decoded_password = base64.b64decode(password).decode('utf-8')
            password = decoded_password
        except Exception:
            # 如果Base64解码失败，使用原始解密密码
            pass
            
    except BaseException as e:
        logging.error(f"Password decryption failed: {e}")
        return get_json_result(
            data=False, code=settings.RetCode.SERVER_ERROR, message="Fail to crypt password"
        )

    # 步骤3: 进行标准数据库认证
    user = UserService.query_user(email, password)
    
    if user:
        # 认证成功
        logging.info(f"User {email} login successful")
        response_data = user.to_json()
        user.access_token = get_uuid()
        login_user(user)
        user.update_time = (current_timestamp(),)
        user.update_date = (datetime_format(datetime.now()),)
        user.save()
        msg = "Welcome back!"
        return construct_response(data=response_data, auth=user.get_id(), message=msg)
    else:
        # 认证失败
        logging.info(f"User {email} login failed - invalid credentials")
        return get_json_result(
            data=False,
            code=settings.RetCode.AUTHENTICATION_ERROR,
            message="Email and password do not match!",
        )


@manager.route("/login/<channel>") # noqa: F821
def oauth_login(channel):
    channel_config = settings.OAUTH_CONFIG.get(channel)
    if not channel_config:
        raise ValueError(f"Invalid channel name: {channel}")
    auth_cli = get_auth_client(channel_config)

    auth_url = auth_cli.get_authorization_url()
    return redirect(auth_url)


@manager.route("/oauth/callback/<channel>", methods=["GET"]) # noqa: F821
def oauth_callback(channel):
    """
    Handle the OAuth/OIDC callback for various channels dynamically.
    """
    try:
        channel_config = settings.OAUTH_CONFIG.get(channel)
        if not channel_config:
            raise ValueError(f"Invalid channel name: {channel}")
        auth_cli = get_auth_client(channel_config)

        # Obtain the authorization code
        code = request.args.get("code")
        if not code:
            return redirect("/?error=missing_code")

        # Exchange authorization code for access token
        token_info = auth_cli.exchange_code_for_token(code)
        access_token = token_info.get("access_token")
        if not access_token:
            return redirect("/?error=token_failed")

        id_token = token_info.get("id_token")

        # Fetch user info
        user_info = auth_cli.fetch_user_info(access_token, id_token=id_token)
        if not user_info.email:
            return redirect("/?error=email_missing")

        # Login or register
        users = UserService.query(email=user_info.email)
        user_id = get_uuid()
        
        if not users:
            try:
                try:
                    avatar = download_img(user_info.avatar_url)
                except Exception as e:
                    logging.exception(e)
                    avatar = ""

                users = user_register(
                    user_id,
                    {
                        "access_token": access_token,
                        "email": user_info.email,
                        "avatar": avatar,
                        "nickname": user_info.nickname,
                        "login_channel": channel,
                        "last_login_time": get_format_time(),
                        "is_superuser": False,
                    },
                )

                if not users:
                    raise Exception(f"Failed to register {user_info.email}")
                if len(users) > 1:
                    raise Exception(f"Same email: {user_info.email} exists!")

                # Try to log in
                user = users[0]
                login_user(user)
                return redirect(f"/?auth_success=true&user_id={user.get_id()}")

            except Exception as e:
                rollback_user_registration(user_id)
                logging.exception(e)
                return redirect(f"/?error={str(e)}")

        # User exists, try to log in
        user = users[0]
        user.access_token = get_uuid()
        login_user(user)
        user.save()
        return redirect(f"/?auth_success=true&user_id={user.get_id()}")
    except Exception as e:
        return redirect(f"/?error={str(e)}")


@manager.route("/github_callback", methods=["GET"])  # noqa: F821
def github_callback():
    """
    GitHub OAuth callback endpoint.
    ---
    tags:
      - OAuth
    parameters:
      - in: query
        name: code
        type: string
        required: true
        description: Authorization code from GitHub.
    responses:
      200:
        description: Authentication successful.
        schema:
          type: object
    """
    import requests

    res = requests.post(
        settings.GITHUB_OAUTH.get("url"),
        data={
            "client_id": settings.GITHUB_OAUTH.get("client_id"),
            "client_secret": settings.GITHUB_OAUTH.get("secret_key"),
            "code": request.args.get("code"),
        },
        headers={"Accept": "application/json"},
    )
    res = res.json()
    if "error" in res:
        return redirect("/?error=%s" % res["error_description"])

    if "user:email" not in res["scope"].split(","):
        return redirect("/?error=user:email not in scope")

    session["access_token"] = res["access_token"]
    session["access_token_from"] = "github"
    user_info = user_info_from_github(session["access_token"])
    email_address = user_info["email"]
    users = UserService.query(email=email_address)
    user_id = get_uuid()
    if not users:
        # User isn't try to register
        try:
            try:
                avatar = download_img(user_info["avatar_url"])
            except Exception as e:
                logging.exception(e)
                avatar = ""
            users = user_register(
                user_id,
                {
                    "access_token": session["access_token"],
                    "email": email_address,
                    "avatar": avatar,
                    "nickname": user_info["login"],
                    "login_channel": "github",
                    "last_login_time": get_format_time(),
                    "is_superuser": False,
                },
            )
            if not users:
                raise Exception(f"Fail to register {email_address}.")
            if len(users) > 1:
                raise Exception(f"Same email: {email_address} exists!")

            # Try to log in
            user = users[0]
            login_user(user)
            return redirect("/?auth=%s" % user.get_id())
        except Exception as e:
            rollback_user_registration(user_id)
            logging.exception(e)
            return redirect("/?error=%s" % str(e))

    # User has already registered, try to log in
    user = users[0]
    user.access_token = get_uuid()
    login_user(user)
    user.save()
    return redirect("/?auth=%s" % user.get_id())


@manager.route("/feishu_callback", methods=["GET"])  # noqa: F821
def feishu_callback():
    """
    Feishu OAuth callback endpoint.
    ---
    tags:
      - OAuth
    parameters:
      - in: query
        name: code
        type: string
        required: true
        description: Authorization code from Feishu.
    responses:
      200:
        description: Authentication successful.
        schema:
          type: object
    """
    import requests

    app_access_token_res = requests.post(
        settings.FEISHU_OAUTH.get("app_access_token_url"),
        data=json.dumps(
            {
                "app_id": settings.FEISHU_OAUTH.get("app_id"),
                "app_secret": settings.FEISHU_OAUTH.get("app_secret"),
            }
        ),
        headers={"Content-Type": "application/json; charset=utf-8"},
    )
    app_access_token_res = app_access_token_res.json()
    if app_access_token_res["code"] != 0:
        return redirect("/?error=%s" % app_access_token_res)

    res = requests.post(
        settings.FEISHU_OAUTH.get("user_access_token_url"),
        data=json.dumps(
            {
                "grant_type": settings.FEISHU_OAUTH.get("grant_type"),
                "code": request.args.get("code"),
            }
        ),
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "Authorization": f"Bearer {app_access_token_res['app_access_token']}",
        },
    )
    res = res.json()
    if res["code"] != 0:
        return redirect("/?error=%s" % res["message"])

    if "contact:user.email:readonly" not in res["data"]["scope"].split():
        return redirect("/?error=contact:user.email:readonly not in scope")
    session["access_token"] = res["data"]["access_token"]
    session["access_token_from"] = "feishu"
    user_info = user_info_from_feishu(session["access_token"])
    email_address = user_info["email"]
    users = UserService.query(email=email_address)
    user_id = get_uuid()
    if not users:
        # User isn't try to register
        try:
            try:
                avatar = download_img(user_info["avatar_url"])
            except Exception as e:
                logging.exception(e)
                avatar = ""
            users = user_register(
                user_id,
                {
                    "access_token": session["access_token"],
                    "email": email_address,
                    "avatar": avatar,
                    "nickname": user_info["en_name"],
                    "login_channel": "feishu",
                    "last_login_time": get_format_time(),
                    "is_superuser": False,
                },
            )
            if not users:
                raise Exception(f"Fail to register {email_address}.")
            if len(users) > 1:
                raise Exception(f"Same email: {email_address} exists!")

            # Try to log in
            user = users[0]
            login_user(user)
            return redirect("/?auth=%s" % user.get_id())
        except Exception as e:
            rollback_user_registration(user_id)
            logging.exception(e)
            return redirect("/?error=%s" % str(e))

    # User has already registered, try to log in
    user = users[0]
    user.access_token = get_uuid()
    login_user(user)
    user.save()
    return redirect("/?auth=%s" % user.get_id())


def user_info_from_feishu(access_token):
    import requests

    headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Authorization": f"Bearer {access_token}",
    }
    res = requests.get(
        "https://open.feishu.cn/open-apis/authen/v1/user_info", headers=headers
    )
    user_info = res.json()["data"]
    user_info["email"] = None if user_info.get("email") == "" else user_info["email"]
    return user_info


def user_info_from_github(access_token):
    import requests

    headers = {"Accept": "application/json", "Authorization": f"token {access_token}"}
    res = requests.get(
        f"https://api.github.com/user?access_token={access_token}", headers=headers
    )
    user_info = res.json()
    email_info = requests.get(
        f"https://api.github.com/user/emails?access_token={access_token}",
        headers=headers,
    ).json()
    user_info["email"] = next(
        (email for email in email_info if email["primary"]), None
    )["email"]
    return user_info


@manager.route("/logout", methods=["GET"])  # noqa: F821
@login_required
def log_out():
    """
    User logout endpoint.
    ---
    tags:
      - User
    security:
      - ApiKeyAuth: []
    responses:
      200:
        description: Logout successful.
        schema:
          type: object
    """
    current_user.access_token = ""
    current_user.save()
    logout_user()
    return get_json_result(data=True)


@manager.route("/setting", methods=["POST"])  # noqa: F821
@login_required
def setting_user():
    """
    Update user settings.
    ---
    tags:
      - User
    security:
      - ApiKeyAuth: []
    parameters:
      - in: body
        name: body
        description: User settings to update.
        required: true
        schema:
          type: object
          properties:
            nickname:
              type: string
              description: New nickname.
            email:
              type: string
              description: New email.
    responses:
      200:
        description: Settings updated successfully.
        schema:
          type: object
    """
    update_dict = {}
    request_data = request.json
    if request_data.get("password"):
        new_password = request_data.get("new_password")
        if not check_password_hash(
                current_user.password, decrypt(request_data["password"])
        ):
            return get_json_result(
                data=False,
                code=settings.RetCode.AUTHENTICATION_ERROR,
                message="Password error!",
            )

        if new_password:
            update_dict["password"] = generate_password_hash(decrypt(new_password))

    for k in request_data.keys():
        if k in [
            "password",
            "new_password",
            "email",
            "status",
            "is_superuser",
            "login_channel",
            "is_anonymous",
            "is_active",
            "is_authenticated",
            "last_login_time",
        ]:
            continue
        update_dict[k] = request_data[k]

    try:
        UserService.update_by_id(current_user.id, update_dict)
        return get_json_result(data=True)
    except Exception as e:
        logging.exception(e)
        return get_json_result(
            data=False, message="Update failure!", code=settings.RetCode.EXCEPTION_ERROR
        )


@manager.route("/info", methods=["GET"])  # noqa: F821
@login_required
def user_profile():
    """
    Get user profile information.
    ---
    tags:
      - User
    security:
      - ApiKeyAuth: []
    responses:
      200:
        description: User profile retrieved successfully.
        schema:
          type: object
          properties:
            id:
              type: string
              description: User ID.
            nickname:
              type: string
              description: User nickname.
            email:
              type: string
              description: User email.
    """
    return get_json_result(data=current_user.to_dict())


def rollback_user_registration(user_id):
    try:
        UserService.delete_by_id(user_id)
    except Exception:
        pass
    try:
        TenantService.delete_by_id(user_id)
    except Exception:
        pass
    try:
        u = UserTenantService.query(tenant_id=user_id)
        if u:
            UserTenantService.delete_by_id(u[0].id)
    except Exception:
        pass
    try:
        TenantLLM.delete().where(TenantLLM.tenant_id == user_id).execute()
    except Exception:
        pass


def user_register(user_id, user):
    user["id"] = user_id
    tenant = {
        "id": user_id,
        "name": user["nickname"] + "‘s Kingdom",
        "llm_id": settings.CHAT_MDL,
        "embd_id": settings.EMBEDDING_MDL,
        "asr_id": settings.ASR_MDL,
        "parser_ids": settings.PARSERS,
        "img2txt_id": settings.IMAGE2TEXT_MDL,
        "rerank_id": settings.RERANK_MDL,
    }
    usr_tenant = {
        "tenant_id": user_id,
        "user_id": user_id,
        "invited_by": user_id,
        "role": UserTenantRole.OWNER,
    }
    file_id = get_uuid()
    file = {
        "id": file_id,
        "parent_id": file_id,
        "tenant_id": user_id,
        "created_by": user_id,
        "name": "/",
        "type": FileType.FOLDER.value,
        "size": 0,
        "location": "",
    }
    tenant_llm = []
    for llm in LLMService.query(fid=settings.LLM_FACTORY):
        tenant_llm.append(
            {
                "tenant_id": user_id,
                "llm_factory": settings.LLM_FACTORY,
                "llm_name": llm.llm_name,
                "model_type": llm.model_type,
                "api_key": settings.API_KEY,
                "api_base": settings.LLM_BASE_URL,
                "max_tokens": llm.max_tokens if llm.max_tokens else 8192
            }
        )

    if not UserService.save(**user):
        return
    TenantService.insert(**tenant)
    UserTenantService.insert(**usr_tenant)
    TenantLLMService.insert_many(tenant_llm)
    FileService.insert(file)
    return UserService.query(email=user["email"])


@manager.route("/register", methods=["POST"])  # noqa: F821
@validate_request("nickname", "email", "password")
def user_add():
    """
    Register a new user.
    ---
    tags:
      - User
    parameters:
      - in: body
        name: body
        description: Registration details.
        required: true
        schema:
          type: object
          properties:
            nickname:
              type: string
              description: User nickname.
            email:
              type: string
              description: User email.
            password:
              type: string
              description: User password.
    responses:
      200:
        description: Registration successful.
        schema:
          type: object
    """

    if not settings.REGISTER_ENABLED:
        return get_json_result(
            data=False,
            message="User registration is disabled!",
            code=settings.RetCode.OPERATING_ERROR,
        )

    req = request.json
    email_address = req["email"]

    # Validate the email address
    if not re.match(r"^[\w\._-]+@([\w_-]+\.)+[\w-]{2,}$", email_address):
        return get_json_result(
            data=False,
            message=f"Invalid email address: {email_address}!",
            code=settings.RetCode.OPERATING_ERROR,
        )

    # Check if the email address is already used
    if UserService.query(email=email_address):
        return get_json_result(
            data=False,
            message=f"Email: {email_address} has already registered!",
            code=settings.RetCode.OPERATING_ERROR,
        )

    # Construct user info data
    nickname = req["nickname"]
    user_dict = {
        "access_token": get_uuid(),
        "email": email_address,
        "nickname": nickname,
        "password": decrypt(req["password"]),
        "login_channel": "password",
        "last_login_time": get_format_time(),
        "is_superuser": False,
    }

    user_id = get_uuid()
    

    
    llm_data = {
        "tenant_id": user_id,
        "llm_factory": "VLLM",
        "model_type": "chat",
        "llm_name": "QwQ-32B",   
        "api_base": "http://192.168.110.214:8000/v1",
        "api_key": "x",
        "max_tokens": 10000
    }
    def add_llm(llm_param):
        req = llm_param 
        factory = req["llm_factory"]
        api_key = req.get("api_key", "x")
        llm_name = req.get("llm_name")

        def apikey_json(keys):
            nonlocal req
            return json.dumps({k: req.get(k, "") for k in keys})

        if factory == "VolcEngine":
            # For VolcEngine, due to its special authentication method
            # Assemble ark_api_key endpoint_id into api_key
            api_key = apikey_json(["ark_api_key", "endpoint_id"])

        elif factory == "Tencent Hunyuan":
            req["api_key"] = apikey_json(["hunyuan_sid", "hunyuan_sk"])
            return set_api_key()

        elif factory == "Tencent Cloud":
            req["api_key"] = apikey_json(["tencent_cloud_sid", "tencent_cloud_sk"])
            return set_api_key()

        elif factory == "Bedrock":
            # For Bedrock, due to its special authentication method
            # Assemble bedrock_ak, bedrock_sk, bedrock_region
            api_key = apikey_json(["bedrock_ak", "bedrock_sk", "bedrock_region"])

        elif factory == "LocalAI":
            llm_name += "___LocalAI"

        elif factory == "HuggingFace":
            llm_name += "___HuggingFace"

        elif factory == "OpenAI-API-Compatible":
            llm_name += "___OpenAI-API"

        elif factory == "VLLM":
            llm_name += "___VLLM"

        elif factory == "XunFei Spark":
            if req["model_type"] == "chat":
                api_key = req.get("spark_api_password", "")
            elif req["model_type"] == "tts":
                api_key = apikey_json(["spark_app_id", "spark_api_secret", "spark_api_key"])

        elif factory == "BaiduYiyan":
            api_key = apikey_json(["yiyan_ak", "yiyan_sk"])

        elif factory == "Fish Audio":
            api_key = apikey_json(["fish_audio_ak", "fish_audio_refid"])

        elif factory == "Google Cloud":
            api_key = apikey_json(["google_project_id", "google_region", "google_service_account_key"])

        elif factory == "Azure-OpenAI":
            api_key = apikey_json(["api_key", "api_version"])

        llm = {
            "tenant_id": user_id,
            "llm_factory": factory,
            "model_type": req["model_type"],
            "llm_name": llm_name,
            "api_base": req.get("api_base", ""),
            "api_key": api_key,
            "max_tokens": req.get("max_tokens")
        }

        msg = ""
        mdl_nm = llm["llm_name"].split("___")[0]
        if llm["model_type"] == LLMType.EMBEDDING.value:
            assert factory in EmbeddingModel, f"Embedding model from {factory} is not supported yet."
            mdl = EmbeddingModel[factory](
                key=llm['api_key'],
                model_name=mdl_nm,
                base_url=llm["api_base"])
            try:
                arr, tc = mdl.encode(["Test if the api key is available"])
                if len(arr[0]) == 0:
                    raise Exception("Fail")
            except Exception as e:
                msg += f"\nFail to access embedding model({mdl_nm})." + str(e)
        elif llm["model_type"] == LLMType.CHAT.value:
            assert factory in ChatModel, f"Chat model from {factory} is not supported yet."
            mdl = ChatModel[factory](
                key=llm['api_key'],
                model_name=mdl_nm,
                base_url=llm["api_base"]
            )
            '''
            try:
                m, tc = mdl.chat(None, [{"role": "user", "content": "Hello! How are you doing!"}], {
                    "temperature": 0.9})
                if not tc and m.find("**ERROR**:") >= 0:
                    raise Exception(m)
            except Exception as e:
                msg += f"\nFail to access model({mdl_nm})." + str(
                    e)
            '''
        elif llm["model_type"] == LLMType.RERANK:
            assert factory in RerankModel, f"RE-rank model from {factory} is not supported yet."
            try:
                mdl = RerankModel[factory](
                    key=llm["api_key"],
                    model_name=mdl_nm,
                    base_url=llm["api_base"]
                )
                arr, tc = mdl.similarity("Hello~ Ragflower!", ["Hi, there!", "Ohh, my friend!"])
                if len(arr) == 0:
                    raise Exception("Not known.")
            except KeyError:
                msg += f"{factory} dose not support this model({mdl_nm})"
            except Exception as e:
                msg += f"\nFail to access model({mdl_nm})." + str(
                    e)
        elif llm["model_type"] == LLMType.IMAGE2TEXT.value:
            assert factory in CvModel, f"Image to text model from {factory} is not supported yet."
            mdl = CvModel[factory](
                key=llm["api_key"],
                model_name=mdl_nm,
                base_url=llm["api_base"]
            )
            try:
                with open(os.path.join(get_project_base_directory(), "web/src/assets/yay.jpg"), "rb") as f:
                    m, tc = mdl.describe(f.read())
                    if not m and not tc:
                        raise Exception(m)
            except Exception as e:
                msg += f"\nFail to access model({mdl_nm})." + str(e)
        elif llm["model_type"] == LLMType.TTS:
            assert factory in TTSModel, f"TTS model from {factory} is not supported yet."
            mdl = TTSModel[factory](
                key=llm["api_key"], model_name=mdl_nm, base_url=llm["api_base"]
            )
            try:
                for resp in mdl.tts("Hello~ Ragflower!"):
                    pass
            except RuntimeError as e:
                msg += f"\nFail to access model({mdl_nm})." + str(e)
        else:
            # TODO: check other type of models
            pass

        if msg:
            return msg

        if not TenantLLMService.filter_update(
                [TenantLLM.tenant_id ==user_id, TenantLLM.llm_factory == factory,
                TenantLLM.llm_name == llm["llm_name"]], llm):
            TenantLLMService.save(**llm)

        return ""
    msg=add_llm(llm_data)
    if(msg):
        return get_data_error_result(message=msg)

    
    try:
        users = user_register(user_id, user_dict)
        if not users:
            raise Exception(f"Fail to register {email_address}.")
        if len(users) > 1:
            raise Exception(f"Same email: {email_address} exists!")
        user = users[0]
        login_user(user)
        return construct_response(
            data=user.to_json(),
            auth=user.get_id(),
            message=f"{nickname}, welcome aboard!",
        )
    except Exception as e:
        rollback_user_registration(user_id)
        logging.exception(e)
        return get_json_result(
            data=False,
            message=f"User registration failure, error: {str(e)}",
            code=settings.RetCode.EXCEPTION_ERROR,
        )

@manager.route("/tenant_info", methods=["GET"])  # noqa: F821
@login_required
def tenant_info():
    """
    Get tenant information.
    ---
    tags:
      - Tenant
    security:
      - ApiKeyAuth: []
    responses:
      200:
        description: Tenant information retrieved successfully.
        schema:
          type: object
          properties:
            tenant_id:
              type: string
              description: Tenant ID.
            name:
              type: string
              description: Tenant name.
            llm_id:
              type: string
              description: LLM ID.
            embd_id:
              type: string
              description: Embedding model ID.
    """
    try:
        tenants = TenantService.get_info_by(current_user.id)
        if not tenants:
            return get_data_error_result(message="Tenant not found!")
        return get_json_result(data=tenants[0])
    except Exception as e:
        return server_error_response(e)


@manager.route("/set_tenant_info", methods=["POST"])  # noqa: F821
@login_required
@validate_request("tenant_id", "asr_id", "embd_id", "img2txt_id", "llm_id")
def set_tenant_info():
    """
    Update tenant information.
    ---
    tags:
      - Tenant
    security:
      - ApiKeyAuth: []
    parameters:
      - in: body
        name: body
        description: Tenant information to update.
        required: true
        schema:
          type: object
          properties:
            tenant_id:
              type: string
              description: Tenant ID.
            llm_id:
              type: string
              description: LLM ID.
            embd_id:
              type: string
              description: Embedding model ID.
            asr_id:
              type: string
              description: ASR model ID.
            img2txt_id:
              type: string
              description: Image to Text model ID.
    responses:
      200:
        description: Tenant information updated successfully.
        schema:
          type: object
    """
    req = request.json
    try:
        tid = req.pop("tenant_id")
        TenantService.update_by_id(tid, req)
        return get_json_result(data=True)
    except Exception as e:
        return server_error_response(e)


