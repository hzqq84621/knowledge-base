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

from api.db.services.canvas_service import UserCanvasService
from api.db.services.user_service import TenantService
from api.utils.api_utils import get_error_data_result, token_required
from api.utils.api_utils import get_result
from flask import request
import logging

@manager.route('/agents', methods=['GET'])  # noqa: F821
@token_required
def list_agents(tenant_id):
    id = request.args.get("id")
    title = request.args.get("title")
    if id or title:
        canvas = UserCanvasService.query(id=id, title=title, user_id=tenant_id)
        if not canvas:
            return get_error_data_result("The agent doesn't exist.")
    page_number = int(request.args.get("page", 1))
    items_per_page = int(request.args.get("page_size", 30))
    orderby = request.args.get("orderby", "update_time")
    if request.args.get("desc") == "False" or request.args.get("desc") == "false":
        desc = False
    else:
        desc = True
    canvas = UserCanvasService.get_list(tenant_id,page_number,items_per_page,orderby,desc,id,title)
    return get_result(data=canvas)

@manager.route('/canvas', methods=['GET'])  # noqa: F821
@token_required
def list_canvas_sdk(tenant_id):
    """SDK版本的Canvas列表接口，基于canvas_list逻辑但使用API Token认证"""
    try:
        # 获取URL参数
        params = request.args.to_dict() if request.args else {}
        
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
                else:
                    logging.warning(f"无法解析is_virtual参数: {is_virtual_value}，使用默认值False")
                    is_virtual_value = False
            filters['is_virtual'] = is_virtual_value
            logging.info(f"应用is_virtual过滤器: {is_virtual_value}")
        if params and 'id' in params:
            filters['id'] = params['id']
        
        logging.info(f"SDK Canvas列表查询条件: tenant_id={tenant_id}, filters={filters}")
        
        # 获取当前用户(tenant_id)所属的租户
        tenants = TenantService.get_joined_tenants_by_user_id(tenant_id)
        tenant_ids = [m["tenant_id"] for m in tenants] if tenants else []
        
        result = []
        
        # 1. 查询用户自己创建的Canvas
        my_canvas_list = UserCanvasService.query(user_id=tenant_id, **filters)
        for c in my_canvas_list:
            try:
                canvas_dict = c.to_dict()
                # 标记为自己创建的Canvas
                canvas_dict["is_own"] = True
                result.append(canvas_dict)
            except Exception as e:
                logging.error(f"Canvas对象转换为字典时出错: {e}")
                continue
        
        # 2. 查询共享给当前用户的Canvas
        if tenant_ids:
            from api.db.db_models import User, UserTenant
            from api.db import UserTenantRole, StatusEnum
            
            # 先找到每个租户中的OWNER用户
            owner_users = UserTenant.select(UserTenant.user_id).where(
                (UserTenant.tenant_id.in_(tenant_ids)) &
                (UserTenant.role == UserTenantRole.OWNER) &
                (UserTenant.status == StatusEnum.VALID.value)
            )
            
            shared_canvas_list = UserCanvasService.model.select().join(
                UserTenant, on=(UserCanvasService.model.user_id == UserTenant.user_id)
            ).join(
                User, on=(UserCanvasService.model.user_id == User.id)
            ).where(
                (UserCanvasService.model.permission == "team") &
                (UserCanvasService.model.user_id != tenant_id) &
                (UserTenant.tenant_id.in_(tenant_ids)) &
                (UserCanvasService.model.user_id.in_(owner_users))  # 只有OWNER角色创建的
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
        
        return get_result(data=result)
        
    except Exception as e:
        logging.exception(f"SDK canvas列表接口异常: {e}")
        return get_error_data_result(f"获取Canvas列表失败: {str(e)}")
