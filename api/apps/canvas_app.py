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
import json
import random
import traceback
from flask import request, Response
from flask_login import login_required, current_user
from api.db.services.canvas_service import CanvasTemplateService, UserCanvasService
from api.db.services.user_service import TenantService,UserTenantService
from api.db.services.user_canvas_version import UserCanvasVersionService
from api.db.services.common_service import CommonService
from api.settings import RetCode
from api.utils import get_uuid
from api.utils.api_utils import get_json_result, server_error_response, validate_request, get_data_error_result
from agent.canvas import Canvas
from peewee import MySQLDatabase, PostgresqlDatabase
from api.db.db_models import APIToken,Conversation,UserCanvasPermission
import logging
import time

@manager.route('/templates', methods=['GET'])  # noqa: F821
@login_required
def templates():
    return get_json_result(data=[c.to_dict() for c in CanvasTemplateService.get_all()])


@manager.route('/list', methods=['GET'])  # noqa: F821
@login_required
def canvas_list():
    try:
        # 尝试从请求中获取查询参数
        query_params = request.json or {}  # 如果request.json为None，使用空字典
        
        # 也支持从URL参数中获取查询条件（适用于GET请求）
        url_params = request.args.to_dict() if request.args else {}
        
        # 合并JSON和URL参数，URL参数优先级更高
        params = {**query_params, **url_params}
        
        filters = {}
        
        # 构建过滤条件
        if params and 'catalog' in params:
            filters['catalog'] = params['catalog']
        if params and 'is_virtual' in params:
            # 确保布尔值类型正确转换
            is_virtual_value = params['is_virtual']
            if isinstance(is_virtual_value, str):
                if is_virtual_value.lower() == 'true':
                    is_virtual_value = True
                elif is_virtual_value.lower() == 'false':
                    is_virtual_value = False
                elif is_virtual_value.isdigit():
                    is_virtual_value = bool(int(is_virtual_value))
            filters['is_virtual'] = is_virtual_value
        if params and 'id' in params:
            filters['id'] = params['id']
        
        logging.info(f"Canvas列表查询条件: user_id={current_user.id}, filters={filters}")
        
        # 获取当前用户所属的租户
        tenants = TenantService.get_joined_tenants_by_user_id(current_user.id)
        tenant_ids = [m["tenant_id"] for m in tenants] if tenants else []
        
        result = []
        
        # 1. 查询用户自己创建的Canvas
        my_canvas_list = UserCanvasService.query(user_id=current_user.id, **filters)
        for c in my_canvas_list:
            try:
                canvas_dict = c.to_dict()
                # 标记为自己创建的Canvas
                canvas_dict["is_own"] = True
                
                # 添加用户自己的昵称 - 确保自己创建的Canvas也有nickname字段
                canvas_dict["nickname"] = current_user.nickname
                
                result.append(canvas_dict)
            except Exception as e:
                logging.error(f"Canvas对象转换为字典时出错: {e}")
                continue
        
        # 2. 查询共享给当前用户的Canvas
        # 根据tenant_ids查询同一租户内、权限为"team"且不是自己创建的Canvas
        if tenant_ids:
            from api.db.db_models import User, UserTenant
            shared_canvas_list = UserCanvasService.model.select().join(
                UserTenant, on=(UserCanvasService.model.user_id == UserTenant.user_id)
            ).join(
                User, on=(UserCanvasService.model.user_id == User.id)
            ).where(
                (UserCanvasService.model.permission == "team") &
                (UserCanvasService.model.user_id != current_user.id) &
                (UserTenant.tenant_id.in_(tenant_ids))
            ).distinct()
            
            # 应用其他过滤条件
            for filter_key, filter_value in filters.items():
                if hasattr(UserCanvasService.model, filter_key):
                    shared_canvas_list = shared_canvas_list.where(
                        getattr(UserCanvasService.model, filter_key) == filter_value
                    )
            
            # 添加到结果列表
            for c in shared_canvas_list:
                try:
                    canvas_dict = c.to_dict()
                    
                    # 获取创建者信息
                    user = User.select().where(User.id == c.user_id).first()
                    if user:
                        canvas_dict["nickname"] = user.nickname
                        
                    # 标记为共享的Canvas
                    canvas_dict["is_own"] = False
                    canvas_dict["is_shared"] = True
                    result.append(canvas_dict)
                except Exception as e:
                    logging.error(f"共享Canvas对象转换为字典时出错: {e}")
                    continue
        
        # 按更新时间倒序排序
        if result:
            result = sorted(result, key=lambda x: x.get("update_time", 0) * -1)
        
        return get_json_result(data=result)
    except Exception as e:
        logging.exception(f"canvas_list接口异常: {e}")
        return get_json_result(data=[], message=f"获取列表失败: {str(e)}")


@manager.route('/rm', methods=['POST'])  # noqa: F821
@validate_request("canvas_ids")
@login_required
def rm():
    for i in request.json["canvas_ids"]:
        if not UserCanvasService.query(user_id=current_user.id,id=i):
            return get_json_result(
                data=False, message='Only owner of canvas authorized for this operation.',
                code=RetCode.OPERATING_ERROR)
        # 不再操作 UserCanvasPermission 表
        UserCanvasService.delete_by_id(i)
    return get_json_result(data=True)


@manager.route('/set', methods=['POST'])  # noqa: F821
@validate_request("dsl", "title")
@login_required
def save():
    req = request.json
    req["user_id"] = current_user.id
    
    # 确保dsl字段格式正确
    if not isinstance(req["dsl"], str):
        req["dsl"] = json.dumps(req["dsl"], ensure_ascii=False)
    req["dsl"] = json.loads(req["dsl"])
    
    # 删除不属于Canvas模型的字段，避免数据库保存时出错
    if "nickname" in req:
        del req["nickname"]
    if "tenant_avatar" in req:
        del req["tenant_avatar"]
    
    # 生成catalog值的函数（如果没有提供）
    def generate_catalog():
        return ''.join(random.choice("123456789abcdefghijklmnopqrstuvwxyz") for i in range(16))
    
    # 如果是新记录且没有catalog，则生成一个
    if "id" not in req:
        # 检查title是否已存在
        if UserCanvasService.query(user_id=current_user.id, title=req["title"].strip()):
            return get_data_error_result(message=f"{req['title'].strip()} already exists.")
        
        req["id"] = get_uuid()
        
        # 如果没有提供catalog，生成一个新的
        if "catalog" not in req or not req["catalog"]:
            req["catalog"] = generate_catalog()
            logging.info(f"为新Canvas生成catalog: {req['catalog']}")
        
        logging.info(f"创建新Canvas: id={req['id']}, title={req['title']}, catalog={req.get('catalog', '未设置')}")
        if not UserCanvasService.save(**req):
            return get_data_error_result(message="Fail to save canvas.")
    else:
        
        # 获取现有记录，确保catalog被保留
        e, existing_canvas = UserCanvasService.get_by_id(req["id"])
        if e and existing_canvas and existing_canvas.catalog:
            # 保留原有的catalog值
            if "catalog" not in req or not req["catalog"]:
                req["catalog"] = existing_canvas.catalog
                logging.info(f"保持现有canvas的catalog: id={req['id']}, catalog={req['catalog']}")
        elif "catalog" not in req or not req["catalog"]:
            # 如果现有记录没有catalog，生成一个
            req["catalog"] = generate_catalog()
            logging.info(f"为现有canvas生成新catalog: id={req['id']}, catalog={req['catalog']}")
        
        logging.info(f"更新Canvas: id={req['id']}, catalog={req.get('catalog', '未设置')}")
        UserCanvasService.update_by_id(req["id"], req)
    
    # 保存版本信息
    UserCanvasVersionService.insert(
        user_canvas_id=req["id"], 
        dsl=req["dsl"], 
        title="{0}_{1}".format(req["title"], time.strftime("%Y_%m_%d_%H_%M_%S"))
    )
    UserCanvasVersionService.delete_all_versions(req["id"])
    
    return get_json_result(data=req)


@manager.route('/get/<canvas_id>', methods=['GET'])  # noqa: F821
@login_required
def get(canvas_id):
    e, c = UserCanvasService.get_by_tenant_id(canvas_id)
    logging.info(f"get canvas_id: {canvas_id} c: {c}")
    if not e:
        return get_data_error_result(message="canvas not found.")
    return get_json_result(data=c)

@manager.route('/getsse/<canvas_id>', methods=['GET'])  # type: ignore # noqa: F821
def getsse(canvas_id):
    token = request.headers.get('Authorization').split()
    if len(token) != 2:
        return get_data_error_result(message='Authorization is not valid!"')
    token = token[1]
    objs = APIToken.query(beta=token)
    if not objs:
        return get_data_error_result(message='Authentication error: API key is invalid!"')
    e, c = UserCanvasService.get_by_id(canvas_id)
    if not e:
        return get_data_error_result(message="canvas not found.")
    return get_json_result(data=c.to_dict())


@manager.route('/completion', methods=['POST'])  # noqa: F821
@validate_request("id")
@login_required
def run():
    req = request.json
    stream = req.get("stream", True)
    e, cvs = UserCanvasService.get_by_id(req["id"])
    if not e:
        return get_data_error_result(message="canvas not found.")
    
    if cvs.is_virtual == True:
        return get_data_error_result(message="can not talk to a virtual assistant")

    if not isinstance(cvs.dsl, str):
        cvs.dsl = json.dumps(cvs.dsl, ensure_ascii=False)

    final_ans = {"reference": [], "content": ""}
    message_id = req.get("message_id", get_uuid())
    try:
        canvas = Canvas(cvs.dsl, current_user.id)
        if "message" in req:
            canvas.messages.append({"role": "user", "content": req["message"], "id": message_id})
            canvas.add_user_input(req["message"])
    except Exception as e:
        return server_error_response(e)

    if stream:
        def sse():
            nonlocal answer, cvs
            try:
                for ans in canvas.run(stream=True):
                    if ans.get("running_status"):
                        yield "data:" + json.dumps({"code": 0, "message": "",
                                                    "data": {"answer": ans["content"],
                                                             "running_status": True}},
                                                   ensure_ascii=False) + "\n\n"
                        continue
                    for k in ans.keys():
                        final_ans[k] = ans[k]
                    ans = {"answer": ans["content"], "reference": ans.get("reference", [])}
                    yield "data:" + json.dumps({"code": 0, "message": "", "data": ans}, ensure_ascii=False) + "\n\n"

                canvas.messages.append({"role": "assistant", "content": final_ans["content"], "id": message_id,"reference":final_ans.get("reference")})
                canvas.history.append(("assistant", final_ans["content"]))
                if not canvas.path[-1]:
                    canvas.path.pop(-1)
                if final_ans.get("reference"):
                    canvas.reference.append(final_ans["reference"])
                cvs.dsl = json.loads(str(canvas))
                UserCanvasService.update_by_id(req["id"], cvs.to_dict())
            except Exception as e:
                cvs.dsl = json.loads(str(canvas))
                if not canvas.path[-1]:
                    canvas.path.pop(-1)
                UserCanvasService.update_by_id(req["id"], cvs.to_dict())
                traceback.print_exc()
                yield "data:" + json.dumps({"code": 500, "message": str(e),
                                            "data": {"answer": "**ERROR**: " + str(e), "reference": []}},
                                           ensure_ascii=False) + "\n\n"
            yield "data:" + json.dumps({"code": 0, "message": "", "data": True}, ensure_ascii=False) + "\n\n"
            UserCanvasService.update_by_id(req["id"], cvs.to_dict())

        resp = Response(sse(), mimetype="text/event-stream")
        resp.headers.add_header("Cache-control", "no-cache")
        resp.headers.add_header("Connection", "keep-alive")
        resp.headers.add_header("X-Accel-Buffering", "no")
        resp.headers.add_header("Content-Type", "text/event-stream; charset=utf-8")
        return resp

    for answer in canvas.run(stream=False):
        if answer.get("running_status"):
            continue
        final_ans["content"] = "\n".join(answer["content"]) if "content" in answer else ""
        canvas.messages.append({"role": "assistant", "content": final_ans["content"], "id": message_id,"reference":final_ans.get("reference")})
        if final_ans.get("reference"):
            canvas.reference.append(final_ans["reference"])
        cvs.dsl = json.loads(str(canvas))
        UserCanvasService.update_by_id(req["id"], cvs.to_dict())
        return get_json_result(data={"answer": final_ans["content"], "reference": final_ans.get("reference", [])})
    UserCanvasService.update_by_id(req["id"], cvs.to_dict())


@manager.route('/reset', methods=['POST'])  # noqa: F821
@validate_request("id")
@login_required
def reset():
    req = request.json
    try:
        e, user_canvas = UserCanvasService.get_by_id(req["id"])
        if not e:
            return get_data_error_result(message="canvas not found.")

        canvas = Canvas(json.dumps(user_canvas.dsl), current_user.id)
        canvas.reset()
        req["dsl"] = json.loads(str(canvas))
        UserCanvasService.update_by_id(req["id"], {"dsl": req["dsl"]})
        return get_json_result(data=req["dsl"])
    except Exception as e:
        return server_error_response(e)


@manager.route('/input_elements', methods=['GET'])  # noqa: F821
@login_required
def input_elements():
    cvs_id = request.args.get("id")
    cpn_id = request.args.get("component_id")
    try:
        e, user_canvas = UserCanvasService.get_by_id(cvs_id)
        if not e:
            return get_data_error_result(message="canvas not found.")

        canvas = Canvas(json.dumps(user_canvas.dsl), current_user.id)
        return get_json_result(data=canvas.get_component_input_elements(cpn_id))
    except Exception as e:
        return server_error_response(e)


@manager.route('/debug', methods=['POST'])  # noqa: F821
@validate_request("id", "component_id", "params")
@login_required
def debug():
    req = request.json
    for p in req["params"]:
        assert p.get("key")
    try:
        e, user_canvas = UserCanvasService.get_by_id(req["id"])
        if not e:
            return get_data_error_result(message="canvas not found.")

        canvas = Canvas(json.dumps(user_canvas.dsl), current_user.id)
        canvas.get_component(req["component_id"])["obj"]._param.debug_inputs = req["params"]
        df = canvas.get_component(req["component_id"])["obj"].debug()
        return get_json_result(data=df.to_dict(orient="records"))
    except Exception as e:
        return server_error_response(e)


@manager.route('/test_db_connect', methods=['POST'])  # noqa: F821
@validate_request("db_type", "database", "username", "host", "port", "password")
@login_required
def test_db_connect():
    req = request.json
    try:
        if req["db_type"] in ["mysql", "mariadb"]:
            db = MySQLDatabase(req["database"], user=req["username"], host=req["host"], port=req["port"],
                               password=req["password"])
        elif req["db_type"] == 'postgresql':
            db = PostgresqlDatabase(req["database"], user=req["username"], host=req["host"], port=req["port"],
                                    password=req["password"])
        elif req["db_type"] == 'mssql':
            import pyodbc
            connection_string = (
                f"DRIVER={{ODBC Driver 17 for SQL Server}};"
                f"SERVER={req['host']},{req['port']};"
                f"DATABASE={req['database']};"
                f"UID={req['username']};"
                f"PWD={req['password']};"
            )
            db = pyodbc.connect(connection_string)
            cursor = db.cursor()
            cursor.execute("SELECT 1")
            cursor.close()
        else:
            return server_error_response("Unsupported database type.")
        if req["db_type"] != 'mssql':
            db.connect()
        db.close()
        
        return get_json_result(data="Database Connection Successful!")
    except Exception as e:
        return server_error_response(e)
#api get list version dsl of canvas
@manager.route('/getlistversion/<canvas_id>', methods=['GET'])  # noqa: F821
@login_required
def getlistversion(canvas_id):
    try:
        list =sorted([c.to_dict() for c in UserCanvasVersionService.list_by_canvas_id(canvas_id)], key=lambda x: x["update_time"]*-1)
        return get_json_result(data=list)
    except Exception as e:
        return get_data_error_result(message=f"Error getting history files: {e}")
#api get version dsl of canvas
@manager.route('/getversion/<version_id>', methods=['GET'])  # noqa: F821
@login_required
def getversion( version_id):
    try:
      
        e, version = UserCanvasVersionService.get_by_id(version_id)
        if version:
            return get_json_result(data=version.to_dict())
    except Exception as e:
        return get_json_result(data=f"Error getting history file: {e}")
    
@manager.route('/listteam', methods=['GET'])  # noqa: F821
@login_required
def list_kbs():
    keywords = request.args.get("keywords", "")
    page_number = int(request.args.get("page", 1))
    items_per_page = int(request.args.get("page_size", 150))
    orderby = request.args.get("orderby", "create_time")
    desc = request.args.get("desc", True)
    try:
        tenants = TenantService.get_joined_tenants_by_user_id(current_user.id)
        kbs, total = UserCanvasService.get_by_tenant_ids(
            [m["tenant_id"] for m in tenants], current_user.id, page_number,
            items_per_page, orderby, desc, keywords)
        return get_json_result(data={"kbs": kbs, "total": total})
    except Exception as e:
        return server_error_response(e)
    
@manager.route('/setting', methods=['POST'])  # noqa: F821
@validate_request("id", "title", "permission")
@login_required
def setting():
    req = request.json
    req["user_id"] = current_user.id
    e,flow = UserCanvasService.get_by_id(req["id"])
    if not e:
        return get_data_error_result(message="canvas not found.")
    flow = flow.to_dict()
    flow["title"] = req["title"]
    if req["description"]:
        flow["description"] = req["description"]
    if req["permission"]:
        flow["permission"] = req["permission"]
    if req["avatar"]:
        flow["avatar"] = req["avatar"]
    num= UserCanvasService.update_by_id(req["id"], flow)
    return get_json_result(data=num)

@manager.route('/update_permissions', methods=['POST'])  # noqa: F821
@validate_request("canvas_ids", "user_ids")
@login_required
def update_permissions():
    req = request.json
    canvas_ids = req["canvas_ids"]
    
    # 不再使用 UserCanvasPermission 表，改为直接设置 Canvas 的 permission 属性
    for canvas_id in canvas_ids:
        e, canvas = UserCanvasService.get_by_id(canvas_id)
        if not e or canvas.user_id != current_user.id:
            return get_json_result(data=False, message='Only owner of canvas authorized for this operation.', code=RetCode.OPERATING_ERROR)
        
        # 直接修改 Canvas 的 permission 属性为 "team"
        canvas_dict = canvas.to_dict()
        canvas_dict["permission"] = "team"
        UserCanvasService.update_by_id(canvas_id, canvas_dict)
        logging.info(f"Canvas {canvas_id} 权限模式已设置为 team")
    
    return get_json_result(data=True)

@manager.route('/get_by_catalog', methods=['POST'])  # noqa: F821
@validate_request("catalog")
@login_required
def get_by_catalog():
    req = request.json
    catalog = req["catalog"]
    list=UserCanvasService.get_or_none(catalog=catalog)
    return get_json_result(data=list)

@manager.route('/get_new_catalog', methods=['GET'])  # noqa: F821
@login_required
def get_new_catalog():
    
    return get_json_result(''.join(random.choice("123456789abcdefghijklmnopqrstuvwxyz") for i in range(16)))

@manager.route('/conversation/list', methods=['GET'])  # noqa: F821
@login_required
def conversation_list():
    try:
        # 尝试从请求中获取查询参数
        query_params = request.json or {}  # 如果request.json为None，使用空字典
        
        # 也支持从URL参数中获取查询条件（适用于GET请求）
        url_params = request.args.to_dict() if request.args else {}
        
        # 合并JSON和URL参数，URL参数优先级更高
        params = {**query_params, **url_params}
        
        filters = {}
        
        # 添加固定条件：is_virtual=False，以只查询对话（非助理）
        filters['is_virtual'] = False
        
        # 构建过滤条件
        if params and 'catalog' in params:
            filters['catalog'] = params['catalog']
            logging.info(f"对话列表按catalog过滤: {params['catalog']}")
        if params and 'dialog_id' in params:
            filters['dialog_id'] = params['dialog_id']
        if params and 'dialogId' in params:
            filters['dialog_id'] = params['dialogId']  # 兼容旧版前端参数名
        if params and 'id' in params:
            filters['id'] = params['id']
        
        logging.info(f"对话列表查询条件: user_id={current_user.id}, filters={filters}")
        
        # 查询数据库
        canvas_list = UserCanvasService.query(user_id=current_user.id, **filters)
        
        # 确保查询结果存在
        if not canvas_list:
            logging.warning(f"未找到满足条件的对话: user_id={current_user.id}, filters={filters}")
            return get_json_result(data=[])
        
        # 转换为字典列表并排序
        result = []
        for c in canvas_list:
            try:
                # 确保每个canvas对象可以正确转换为字典
                canvas_dict = c.to_dict()
                result.append(canvas_dict)
            except Exception as e:
                logging.error(f"canvas对象转换为字典时出错: {e}")
                # 跳过出错的对象，继续处理其他对象
                continue
        
        # 按更新时间倒序排序
        if result:
            result = sorted(result, key=lambda x: x.get("update_time", 0) * -1)
        
        return get_json_result(data=result)
    except Exception as e:
        logging.exception(f"conversation_list接口异常: {e}")
        return get_json_result(data=[], message=f"获取对话列表失败: {str(e)}")

@manager.route('/clone', methods=['POST'])  # noqa: F821
@validate_request("canvas_id")
@login_required
def clone():
    """克隆Canvas功能
    请求参数:
    - canvas_id: 要克隆的Canvas ID
    - new_title: (可选) 新Canvas的标题，如果不提供则自动生成"原标题_clone"
    - is_virtual: (可选) 是否为虚拟助理，默认False表示对话
    - catalog: (可选) 目录ID，如果提供则使用该catalog，否则生成新catalog
    - preserve_catalog: (可选) 是否保留源对象的catalog，优先级高于catalog参数
    - keep_history: (可选) 是否保留聊天历史，默认False表示新对话不保留历史
    
    返回:
    - 新创建的Canvas详情
    """
    try:
        req = request.json
        source_id = req["canvas_id"]
        
        # 获取源Canvas
        e, source_canvas = UserCanvasService.get_by_id(source_id)
        if not e:
            return get_data_error_result(message="Source canvas not found.")
        
        # 检查用户权限（用户必须对源Canvas有访问权限）
        has_permission = False
        # 检查是否是所有者
        if source_canvas.user_id == current_user.id:
            has_permission = True
        # 不是所有者，检查是否是团队共享
        else:
            # 获取当前用户所属的租户
            tenants = TenantService.get_joined_tenants_by_user_id(current_user.id)
            tenant_ids = [m["tenant_id"] for m in tenants] if tenants else []
            
            if tenant_ids:
                from api.db.db_models import UserTenant
                # 检查源Canvas创建者是否与当前用户在同一租户，且Canvas权限为team
                creator_in_same_tenant = UserTenant.select().where(
                    (UserTenant.user_id == source_canvas.user_id) &
                    (UserTenant.tenant_id.in_(tenant_ids))
                ).exists()
                
                if creator_in_same_tenant and source_canvas.permission == "team":
                    has_permission = True
                    logging.info(f"用户 {current_user.id} 通过团队共享权限访问 Canvas {source_id}")
                
        if not has_permission:
            return get_json_result(
                data=False, 
                message='No permission to access the source canvas.',
                code=RetCode.OPERATING_ERROR)
        
        # 准备新Canvas数据
        source_data = source_canvas.to_dict()
        
        # 删除不属于Canvas模型的字段，避免数据库保存时出错
        if "nickname" in source_data:
            del source_data["nickname"]
        if "tenant_avatar" in source_data:
            del source_data["tenant_avatar"]
        
        # 生成新ID
        new_id = get_uuid()
        
        # 确定catalog值：1.如果preserve_catalog为True，使用源对象的catalog；2.如果提供catalog，使用提供的值；3.否则生成新catalog
        if req.get("preserve_catalog") and source_data.get("catalog"):
            new_catalog = source_data.get("catalog")
            logging.info(f"保留源对象catalog: {new_catalog}")
        elif req.get("catalog"):
            new_catalog = req.get("catalog")
            logging.info(f"使用提供的catalog: {new_catalog}")
        else:
            new_catalog = ''.join(random.choice("123456789abcdefghijklmnopqrstuvwxyz") for i in range(16))
            logging.info(f"生成新catalog: {new_catalog}")
        
        # 设置新标题
        if "new_title" in req and req["new_title"].strip():
            new_title = req["new_title"].strip()
        else:
            new_title = f"{source_data['title']}_clone"
            
            # 确保标题不重复
            counter = 1
            while UserCanvasService.query(user_id=current_user.id, title=new_title):
                new_title = f"{source_data['title']}_clone_{counter}"
                counter += 1
        
        # 明确处理is_virtual参数
        # 默认为False（对话），除非明确指定为True
        is_virtual = False
        if "is_virtual" in req:
            # 确保布尔值类型正确转换
            is_virtual_value = req["is_virtual"]
            if isinstance(is_virtual_value, str):
                if is_virtual_value.lower() == 'true':
                    is_virtual = True
                elif is_virtual_value.lower() == 'false':
                    is_virtual = False
                elif is_virtual_value.isdigit():
                    is_virtual = bool(int(is_virtual_value))
            else:
                is_virtual = bool(is_virtual_value)
        
        logging.info(f"设置is_virtual={is_virtual}（{'虚拟助理' if is_virtual else '对话'}）")
        
        # 深拷贝源对象的DSL，确保不会共享引用
        dsl_copy = None
        if source_data.get("dsl"):
            try:
                if isinstance(source_data["dsl"], str):
                    dsl_copy = json.loads(source_data["dsl"])
                else:
                    dsl_copy = json.loads(json.dumps(source_data["dsl"]))
                
                # 如果是对话（非虚拟助理），且不保留历史，则重置聊天历史
                if not is_virtual and not req.get("keep_history", False):
                    # 清空历史消息和路径，让Canvas从begin节点自然运行
                    logging.info("创建新对话，清空聊天历史，让begin节点自然处理欢迎语")
                    
                    # 查找系统消息
                    system_message = None
                    
                    # 保存系统消息
                    if "messages" in dsl_copy and dsl_copy["messages"]:
                        for msg in dsl_copy["messages"]:
                            # 保留系统角色消息
                            if msg.get("role") == "system":
                                system_message = msg
                                logging.info(f"找到系统消息: {system_message}")
                                break
                    
                    # 重置消息历史，但保留系统消息
                    new_messages = []
                    if system_message:
                        new_messages.append(system_message)
                    
                    # 更新DSL
                    dsl_copy["messages"] = new_messages
                    dsl_copy["history"] = []  # 清空历史
                    
                    # 只保留初始路径，通常是第一步
                    if "path" in dsl_copy:
                        if dsl_copy["path"] and len(dsl_copy["path"]) > 0:
                            dsl_copy["path"] = [dsl_copy["path"][0]] if dsl_copy["path"] else []
                        else:
                            dsl_copy["path"] = []
                    
                    # 清空引用
                    if "reference" in dsl_copy:
                        dsl_copy["reference"] = []
                    
                    # 处理组件状态，重置输出但保留系统初始状态
                    if "components" in dsl_copy:
                        for component_id, component in dsl_copy["components"].items():
                            # 保留begin节点的初始配置
                            if component_id.startswith("begin"):
                                continue
                                
                            # 其他组件重置状态
                            if "obj" in component:
                                if "output" in component["obj"]:
                                    component["obj"]["output"] = None
                                if "inputs" in component["obj"]:
                                    component["obj"]["inputs"] = []
                                # 清除debug_inputs
                                if "params" in component["obj"] and "debug_inputs" in component["obj"]["params"]:
                                    component["obj"]["params"]["debug_inputs"] = []
            except Exception as e:
                logging.error(f"处理DSL时出错: {e}")
                # 如果处理出错，使用原始DSL
                dsl_copy = source_data["dsl"]
                logging.error(f"回退到原始DSL")
        else:
            dsl_copy = source_data.get("dsl")
        
        # 创建新Canvas记录
        new_canvas = {
            "id": new_id,
            "user_id": current_user.id,
            "title": new_title,
            "catalog": new_catalog,
            "dsl": dsl_copy,
            "description": source_data.get("description", ""),
            "avatar": source_data.get("avatar", ""),
            "permission": source_data.get("permission", "private"),
            "is_virtual": is_virtual  # 使用处理后的is_virtual值
        }
        
        # 保存新Canvas
        if not UserCanvasService.save(**new_canvas):
            return get_data_error_result(message="Failed to clone canvas.")
            
        logging.info(f"Canvas克隆成功: 源ID={source_id}, 新ID={new_id}, 标题={new_title}")
        
        # 自动触发begin组件执行，显示欢迎语
        try:
            canvas = Canvas(json.dumps(dsl_copy), current_user.id)
            logging.info("开始自动执行Canvas流程，生成欢迎语")
            
            # 使用Canvas正常流程运行，这将自动从begin节点开始执行
            for answer in canvas.run(stream=False):
                # 跳过中间状态更新
                if answer.get("running_status"):
                    continue
                
                # 答案已经自动添加到Canvas中，无需手动添加
                logging.info(f"Canvas流程自动执行完成，生成欢迎消息")
                break
                
            # 更新DSL状态
            dsl_copy = json.loads(str(canvas))
            new_canvas["dsl"] = dsl_copy
            UserCanvasService.update_by_id(new_id, {"dsl": dsl_copy})
            logging.info(f"已更新DSL状态，消息数量: {len(dsl_copy.get('messages', []))}，路径: {dsl_copy.get('path', [])}")
        except Exception as e:
            logging.warning(f"自动执行begin组件时出错: {e}，继续返回结果")
        
        # 返回新创建的Canvas
        return get_json_result(data=new_canvas)
    except Exception as e:
        logging.exception(f"clone接口异常: {e}")
        return server_error_response(e)