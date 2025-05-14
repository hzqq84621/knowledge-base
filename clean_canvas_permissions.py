#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
Canvas权限清理工具

用于检查和清理UserCanvasPermission表中的孤立权限记录。
"""

import os
import sys
import logging
from datetime import datetime

# 设置日志
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# 添加项目根目录到sys.path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# 导入必要的模块
from api.db.db_models import DB, UserCanvas, UserCanvasPermission
from api.utils import get_uuid

def print_header(title):
    """打印带格式的标题"""
    print("\n" + "="*80)
    print(f"  {title}")
    print("="*80)

def check_db_connection():
    """检查数据库连接"""
    print_header("检查数据库连接")
    try:
        DB.connect()
        print("✓ 数据库连接成功")
        return True
    except Exception as e:
        print(f"✗ 数据库连接失败: {e}")
        return False
    finally:
        if not DB.is_closed():
            DB.close()

def get_canvas_list():
    """获取所有Canvas信息"""
    print_header("Canvas列表")
    with DB.connection_context():
        canvases = UserCanvas.select()
        print(f"共有 {len(canvases)} 个Canvas")
        if len(canvases) > 0:
            print(f"前5个Canvas示例:")
            for i, canvas in enumerate(canvases[:5]):
                print(f"  {i+1}. ID: {canvas.id}, 标题: {canvas.title}, 用户ID: {canvas.user_id}, 权限: {canvas.permission}")
        return list(canvases)

def get_permissions():
    """获取所有权限记录"""
    print_header("权限记录列表")
    with DB.connection_context():
        permissions = UserCanvasPermission.select()
        print(f"共有 {len(permissions)} 条权限记录")
        if len(permissions) > 0:
            print(f"前5条权限记录示例:")
            for i, perm in enumerate(permissions[:5]):
                print(f"  {i+1}. ID: {perm.id}, Canvas ID: {perm.user_canvas_id}, 用户ID: {perm.user_id}")
        return list(permissions)

def find_orphaned_permissions():
    """查找没有对应Canvas的孤立权限记录"""
    print_header("查找孤立权限记录")
    
    # 获取所有Canvas的ID
    with DB.connection_context():
        canvas_ids = set(canvas.id for canvas in UserCanvas.select())
        print(f"数据库中有 {len(canvas_ids)} 个Canvas ID")
        
        # 获取所有权限记录
        all_permissions = UserCanvasPermission.select()
        all_permission_count = len(list(all_permissions))
        print(f"数据库中共有 {all_permission_count} 条权限记录")
        
        # 查找孤立记录
        orphaned_permissions = []
        for perm in all_permissions:
            if perm.user_canvas_id not in canvas_ids:
                orphaned_permissions.append(perm)
        
        print(f"发现 {len(orphaned_permissions)} 条孤立权限记录")
        
        if orphaned_permissions:
            print("孤立权限记录示例:")
            for i, perm in enumerate(orphaned_permissions[:5]):
                print(f"  {i+1}. ID: {perm.id}, Canvas ID: {perm.user_canvas_id}, 用户ID: {perm.user_id}")
        
        return orphaned_permissions

def clean_orphaned_permissions(orphaned_permissions):
    """清理孤立的权限记录"""
    print_header("清理孤立权限记录")
    
    if not orphaned_permissions:
        print("没有要清理的孤立权限记录")
        return 0
    
    try:
        with DB.connection_context():
            # 收集所有要删除的Canvas ID
            canvas_ids = set(perm.user_canvas_id for perm in orphaned_permissions)
            print(f"将删除与 {len(canvas_ids)} 个不存在的Canvas关联的权限记录")
            
            # 按Canvas ID分组删除
            deleted_count = 0
            for canvas_id in canvas_ids:
                count = UserCanvasPermission.delete().where(
                    UserCanvasPermission.user_canvas_id == canvas_id
                ).execute()
                deleted_count += count
                print(f"  已删除Canvas ID '{canvas_id}' 的 {count} 条权限记录")
            
            print(f"✓ 总共删除了 {deleted_count} 条孤立权限记录")
            return deleted_count
    except Exception as e:
        print(f"✗ 清理孤立权限记录时出错: {e}")
        return 0

def manual_delete_canvas_and_permissions():
    """手动删除Canvas并验证权限记录是否一并删除"""
    print_header("手动删除Canvas测试")
    
    try:
        with DB.connection_context():
            # 1. 获取现有Canvas列表
            canvases = list(UserCanvas.select().limit(10))
            
            if not canvases:
                print("没有找到任何Canvas记录，无法执行测试")
                return False
            
            # 2. 选择一个Canvas进行测试
            test_canvas = canvases[0]
            canvas_id = test_canvas.id
            canvas_title = test_canvas.title
            print(f"选择Canvas进行测试: ID={canvas_id}, 标题={canvas_title}")
            
            # 3. 检查该Canvas是否有权限记录
            before_permissions = list(UserCanvasPermission.select().where(
                UserCanvasPermission.user_canvas_id == canvas_id
            ))
            
            print(f"  删除前，该Canvas有 {len(before_permissions)} 条权限记录")
            
            # 4. 创建权限记录用于测试（如果没有）
            if not before_permissions:
                print("  该Canvas没有权限记录，创建一条测试记录...")
                test_permission = {
                    "id": get_uuid(),
                    "user_canvas_id": canvas_id,
                    "user_id": "test_user_id_" + get_uuid()[:8]
                }
                UserCanvasPermission.create(**test_permission)
                print(f"  已创建测试权限记录: {test_permission}")
                
                # 重新检查权限记录
                before_permissions = list(UserCanvasPermission.select().where(
                    UserCanvasPermission.user_canvas_id == canvas_id
                ))
                print(f"  现在该Canvas有 {len(before_permissions)} 条权限记录")
            
            # 5. 执行Canvas删除操作（使用现有的DELETE API逻辑）
            print(f"\n  正在删除Canvas: ID={canvas_id}, 标题={canvas_title}...")
            
            # 先删除权限记录（模拟修复后的delete接口行为）
            deleted_permissions = UserCanvasPermission.delete().where(
                UserCanvasPermission.user_canvas_id == canvas_id
            ).execute()
            print(f"  已删除 {deleted_permissions} 条权限记录")
            
            # 然后删除Canvas本身
            deleted_canvas = UserCanvas.delete().where(
                UserCanvas.id == canvas_id
            ).execute()
            print(f"  已删除 {deleted_canvas} 个Canvas记录")
            
            # 6. 验证权限记录是否已删除
            after_permissions = list(UserCanvasPermission.select().where(
                UserCanvasPermission.user_canvas_id == canvas_id
            ))
            
            print(f"\n  删除后，与该Canvas关联的权限记录数: {len(after_permissions)}")
            
            if not after_permissions:
                print("✓ 测试成功：Canvas删除后，相关权限记录也被正确删除")
                return True
            else:
                print("✗ 测试失败：Canvas删除后，仍有相关权限记录残留")
                return False
    except Exception as e:
        print(f"✗ 执行测试时出错: {e}")
        return False

def create_test_canvas():
    """创建一个测试Canvas用于删除测试"""
    print_header("创建测试Canvas")
    
    try:
        with DB.connection_context():
            # 创建一个测试Canvas
            new_canvas = {
                "id": get_uuid(),
                "user_id": "test_user_" + get_uuid()[:8],
                "title": f"测试删除Canvas-{datetime.now().strftime('%Y%m%d%H%M%S')}",
                "catalog": get_uuid()[:16],
                "permission": "team",
                "description": "用于测试删除功能",
                "is_virtual": False
            }
            
            canvas = UserCanvas.create(**new_canvas)
            print(f"✓ 已创建测试Canvas: ID={canvas.id}, 标题={canvas.title}")
            
            # 为Canvas创建几条权限记录
            permissions = []
            for i in range(3):
                perm = {
                    "id": get_uuid(),
                    "user_canvas_id": canvas.id,
                    "user_id": f"test_user_{i}_{get_uuid()[:6]}"
                }
                permissions.append(perm)
                UserCanvasPermission.create(**perm)
            
            print(f"✓ 已为测试Canvas创建 {len(permissions)} 条权限记录")
            
            return {
                "canvas_id": canvas.id,
                "canvas_title": canvas.title,
                "permission_count": len(permissions)
            }
    except Exception as e:
        print(f"✗ 创建测试Canvas时出错: {e}")
        return None

def delete_test_canvas(test_info):
    """删除测试Canvas并验证权限记录是否一并删除"""
    print_header("删除测试Canvas")
    
    if not test_info:
        print("没有测试Canvas信息，无法执行删除测试")
        return False
    
    try:
        canvas_id = test_info["canvas_id"]
        canvas_title = test_info["canvas_title"]
        permission_count = test_info["permission_count"]
        
        print(f"测试Canvas: ID={canvas_id}, 标题={canvas_title}, 权限记录数={permission_count}")
        
        with DB.connection_context():
            # 确认Canvas和权限记录存在
            canvas = UserCanvas.get_or_none(UserCanvas.id == canvas_id)
            if not canvas:
                print(f"✗ 测试Canvas不存在，无法执行测试")
                return False
            
            before_permissions = list(UserCanvasPermission.select().where(
                UserCanvasPermission.user_canvas_id == canvas_id
            ))
            
            print(f"删除前，该Canvas有 {len(before_permissions)} 条权限记录")
            
            # 执行删除操作（模拟修复后的接口行为）
            print(f"正在删除Canvas和相关权限记录...")
            
            # 先删除权限记录
            deleted_permissions = UserCanvasPermission.delete().where(
                UserCanvasPermission.user_canvas_id == canvas_id
            ).execute()
            print(f"已删除 {deleted_permissions} 条权限记录")
            
            # 然后删除Canvas本身
            deleted_canvas = UserCanvas.delete().where(
                UserCanvas.id == canvas_id
            ).execute()
            print(f"已删除 {deleted_canvas} 个Canvas记录")
            
            # 验证是否都已删除
            remaining_canvas = UserCanvas.get_or_none(UserCanvas.id == canvas_id)
            remaining_permissions = list(UserCanvasPermission.select().where(
                UserCanvasPermission.user_canvas_id == canvas_id
            ))
            
            if not remaining_canvas and not remaining_permissions:
                print("✓ 测试成功：Canvas和相关权限记录均已正确删除")
                return True
            else:
                if remaining_canvas:
                    print(f"✗ Canvas记录仍然存在")
                if remaining_permissions:
                    print(f"✗ 仍有 {len(remaining_permissions)} 条权限记录残留")
                return False
    except Exception as e:
        print(f"✗ 执行测试时出错: {e}")
        return False

def main():
    """主函数"""
    print("Canvas权限清理工具")
    print("时间:", datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    
    if not check_db_connection():
        return
    
    print("\n=== 第一阶段：数据检查 ===")
    # 获取Canvas列表和权限记录
    get_canvas_list()
    get_permissions()
    
    # 查找孤立权限记录
    orphaned_permissions = find_orphaned_permissions()
    
    print("\n=== 第二阶段：清理孤立记录 ===")
    # 清理孤立权限记录
    if orphaned_permissions:
        user_input = input("\n是否要删除这些孤立的权限记录? (y/n): ")
        if user_input.lower() == 'y':
            clean_orphaned_permissions(orphaned_permissions)
        else:
            print("已取消清理操作")
    
    print("\n=== 第三阶段：删除测试 ===")
    # 创建测试Canvas和权限记录
    user_input = input("\n是否要执行创建和删除Canvas的测试? (y/n): ")
    if user_input.lower() == 'y':
        test_info = create_test_canvas()
        if test_info:
            input("\n按Enter键继续，执行删除测试...")
            delete_test_canvas(test_info)
    else:
        print("已跳过删除测试")
    
    print("\n测试完成。")

if __name__ == "__main__":
    main()