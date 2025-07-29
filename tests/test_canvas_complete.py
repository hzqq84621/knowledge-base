#!/usr/bin/env python3
"""
Canvas对话系统完整测试脚本

本脚本提供多种测试模式：
1. list模式：列出所有可访问的Canvas
2. interactive模式：交互式对话测试
3. auto模式：自动化对话测试  
4. session模式：完整会话管理测试

使用方法：
    python test_canvas_complete.py --mode [list|interactive|auto|session]

环境要求：
    - 有效的API Token
    - RAGFlow服务正在运行
"""

import requests
import json
import time
import uuid
import argparse
from typing import Dict, List, Optional, Any, Tuple


class CanvasCompleteTester:
    def __init__(self, api_token: str, base_url: str = "http://localhost:9380"):
        self.api_token = api_token
        self.base_url = base_url.rstrip('/')
        self.headers = {
            "Authorization": f"Bearer {api_token}",
            "Content-Type": "application/json"
        }
        self.test_results = []
        
    def log_test_result(self, test_name: str, success: bool, message: str, details: Any = None):
        """记录测试结果"""
        result = {
            "test_name": test_name,
            "success": success,
            "message": message,
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "details": details
        }
        self.test_results.append(result)
        
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"{status} {test_name}: {message}")
        if details and not success:
            print(f"    详细信息: {details}")
    
    def make_request(self, method: str, endpoint: str, data: Dict = None, params: Dict = None) -> Tuple[bool, Dict]:
        """发送HTTP请求的通用方法"""
        url = f"{self.base_url}{endpoint}"
        
        try:
            if method.upper() == "GET":
                response = requests.get(url, headers=self.headers, params=params, timeout=30)
            elif method.upper() == "POST":
                response = requests.post(url, headers=self.headers, json=data, params=params, timeout=30)
            elif method.upper() == "PUT":
                response = requests.put(url, headers=self.headers, json=data, params=params, timeout=30)
            elif method.upper() == "DELETE":
                response = requests.delete(url, headers=self.headers, json=data, params=params, timeout=30)
            else:
                return False, {"error": f"Unsupported HTTP method: {method}"}
            
            # 检查HTTP状态码
            if response.status_code != 200:
                return False, {"error": f"HTTP {response.status_code}: {response.text}"}
            
            # 解析JSON响应
            try:
                json_response = response.json()
                return True, json_response
            except json.JSONDecodeError as e:
                return False, {"error": f"JSON decode error: {str(e)}, response: {response.text}"}
                
        except requests.exceptions.RequestException as e:
            return False, {"error": str(e)}

    def check_server_health(self) -> bool:
        """检查服务器是否正常运行"""
        print("🔍 检查服务器健康状态...")
        try:
            response = requests.get(f"{self.base_url}/health", timeout=10)
            if response.status_code == 200:
                print("✅ 服务器正常运行 (状态码: 200)")
                return True
            else:
                print(f"⚠️ 服务器响应异常 (状态码: {response.status_code})")
                return True  # 继续测试，可能health接口不存在但服务正常
        except requests.exceptions.RequestException:
            print("⚠️ 无法访问health接口，尝试继续测试...")
            return True  # 继续测试

    def get_canvas_list(self) -> Tuple[bool, List[Dict]]:
        """获取Canvas列表"""
        print("📋 获取Canvas列表...")
        
        try:
            success, response = self.make_request(
                "GET", 
                "/api/v1/canvas",
                params={
                    "page": 1,
                    "page_size": 100,
                    "orderby": "update_time",
                    "desc": "true"
                }
            )
            
            if not success:
                print(f"❌ Canvas接口请求失败: {response.get('error', 'Unknown error')}")
                return False, []
            
            if response.get("code") != 0:
                print(f"❌ Canvas接口返回错误: {response.get('message', 'Unknown error')}")
                return False, []
            
            canvas_list = response.get("data", [])
            print(f"✅ 成功获取 {len(canvas_list)} 个Canvas")
            
            if len(canvas_list) > 0:
                # 显示第一个Canvas的字段，帮助调试
                first_canvas = canvas_list[0]
                print(f"🔍 第一个Canvas字段: {list(first_canvas.keys()) if isinstance(first_canvas, dict) else 'Not a dict'}")
            
            return True, canvas_list
            
        except Exception as e:
            print(f"❌ 获取Canvas列表异常: {e}")
            return False, []

    def display_canvas_list(self, canvases: List[Dict]) -> None:
        """显示Canvas列表"""
        if not canvases:
            print("📝 没有找到可访问的Canvas")
            return
        
        print(f"\n📋 Canvas列表 (共 {len(canvases)} 个):")
        print("=" * 80)
        
        agents_count = 0
        conversations_count = 0
        
        for i, canvas in enumerate(canvases, 1):
            canvas_id = canvas.get('id', 'Unknown')
            title = canvas.get('title', '未命名')
            description = canvas.get('description', '无描述')
            is_virtual = canvas.get('is_virtual', False)
            create_time = canvas.get('create_date', canvas.get('create_time', 'Unknown'))
            update_time = canvas.get('update_date', canvas.get('update_time', 'Unknown'))
            
            canvas_type = "Canvas/Agent" if is_virtual else "对话"
            if is_virtual:
                agents_count += 1
            else:
                conversations_count += 1
            
            print(f"{i}. {title}")
            print(f"   ID: {canvas_id}")
            print(f"   描述: {description}")
            print(f"   类型: {canvas_type} (is_virtual={is_virtual})")
            print(f"   创建时间: {create_time}")
            print(f"   更新时间: {update_time}")
            print("-" * 80)
        
        print(f"\n📊 统计信息:")
        print(f"   - 总Canvas数: {len(canvases)}")
        print(f"   - 真正的Agent/Canvas数: {agents_count}")
        print(f"   - 对话数: {conversations_count}")

    def create_session(self, agent_id: str, session_name: str = None) -> Tuple[bool, Optional[str]]:
        """创建会话"""
        session_name = session_name or f"测试会话_{int(time.time())}"
        
        data = {
            "name": session_name
        }
        
        success, response = self.make_request("POST", f"/api/v1/agents/{agent_id}/sessions", data)
        
        if not success:
            print(f"❌ 创建会话失败: {response}")
            return False, None
        
        if response.get("code") != 0:
            print(f"❌ 创建会话失败: {response.get('message', 'Unknown error')}")
            return False, None
        
        session_data = response.get("data", {})
        session_id = session_data.get("id")
        
        if session_id:
            print(f"✅ 成功创建会话: {session_id}")
            return True, session_id
        else:
            print(f"❌ 会话创建响应中没有ID: {session_data}")
            return False, None

    def send_message(self, agent_id: str, session_id: str, message: str) -> Tuple[bool, Optional[str]]:
        """发送消息"""
        data = {
            "session_id": session_id,
            "question": message,
            "stream": False
        }
        
        success, response = self.make_request("POST", f"/api/v1/agents/{agent_id}/completions", data)
        
        if not success:
            print(f"❌ 发送消息失败: {response}")
            return False, None
        
        if response.get("code") != 0:
            print(f"❌ 发送消息失败: {response.get('message', 'Unknown error')}")
            return False, None
        
        answer = response.get("data", {}).get("answer", "")
        return True, answer

    def list_sessions(self, agent_id: str) -> Tuple[bool, List[Dict]]:
        """获取会话列表"""
        success, response = self.make_request("GET", f"/api/v1/agents/{agent_id}/sessions")
        
        if not success:
            return False, []
        
        if response.get("code") != 0:
            return False, []
        
        sessions = response.get("data", [])
        return True, sessions

    def delete_session(self, agent_id: str, session_id: str) -> bool:
        """删除会话"""
        data = {"ids": [session_id]}
        
        success, response = self.make_request("DELETE", f"/api/v1/agents/{agent_id}/sessions", data)
        
        if not success:
            return False
        
        return response.get("code") == 0

    def run_list_mode(self) -> None:
        """列表模式"""
        print("🚀 开始Canvas列表测试")
        print(f"测试目标: {self.base_url}")
        print(f"API Token: {self.api_token[:15]}...")
        print("=" * 80)
        
        # 检查服务器健康状态
        if not self.check_server_health():
            return
        
        # 获取Canvas列表
        success, canvases = self.get_canvas_list()
        if not success:
            print("❌ 无法获取Canvas列表")
            return
        
        # 显示Canvas列表
        self.display_canvas_list(canvases)

    def run_interactive_mode(self) -> None:
        """交互模式"""
        print("🚀 开始Canvas交互对话测试")
        print("=" * 80)
        
        # 获取Canvas列表
        success, canvases = self.get_canvas_list()
        if not success:
            print("❌ 无法获取Canvas列表")
            return
        
        # 过滤出真正的Agent
        agents = [c for c in canvases if c.get("is_virtual", False)]
        if not agents:
            print("❌ 没有找到可用的Agent")
            return
        
        # 显示可选的Agent
        print("\n📋 可用的Agent:")
        for i, agent in enumerate(agents, 1):
            print(f"{i}. {agent.get('title', 'Untitled')} (ID: {agent.get('id')})")
        
        # 用户选择Agent
        try:
            choice = int(input(f"\n请选择要对话的Agent (1-{len(agents)}): ")) - 1
            if choice < 0 or choice >= len(agents):
                print("❌ 选择无效")
                return
        except ValueError:
            print("❌ 输入无效")
            return
        
        selected_agent = agents[choice]
        agent_id = selected_agent.get("id")
        agent_name = selected_agent.get("title", "Unknown")
        
        print(f"\n🎯 选择的Agent: {agent_name}")
        
        # 创建会话
        success, session_id = self.create_session(agent_id, f"交互测试会话_{int(time.time())}")
        if not success:
            return
        
        # 开始交互对话
        print(f"\n💬 开始与 {agent_name} 的对话 (输入 'exit' 或 'quit' 退出)")
        print("-" * 60)
        
        while True:
            try:
                user_input = input("\n您: ").strip()
                if user_input.lower() in ['exit', 'quit', '退出']:
                    print("👋 对话结束")
                    break
                
                if not user_input:
                    continue
                
                print("💭 Agent正在思考...")
                success, answer = self.send_message(agent_id, session_id, user_input)
                
                if success and answer:
                    print(f"🤖 {agent_name}: {answer}")
                else:
                    print("❌ 发送消息失败")
                    
            except KeyboardInterrupt:
                print("\n👋 对话被中断")
                break
            except Exception as e:
                print(f"❌ 发生错误: {e}")
                break
        
        # 清理：删除测试会话
        print(f"\n🗑️ 清理测试会话...")
        if self.delete_session(agent_id, session_id):
            print("✅ 测试会话已删除")
        else:
            print("⚠️ 测试会话删除失败")

    def run_auto_mode(self) -> None:
        """自动化测试模式"""
        print("🚀 开始Canvas自动化测试")
        print("=" * 80)
        
        # 获取Canvas列表
        success, canvases = self.get_canvas_list()
        if not success:
            print("❌ 无法获取Canvas列表")
            return
        
        # 过滤出真正的Agent
        agents = [c for c in canvases if c.get("is_virtual", False)]
        if not agents:
            print("❌ 没有找到可用的Agent")
            return
        
        # 选择前2个Agent进行测试
        test_agents = agents[:2]
        test_messages = [
            "你好，这是一个自动化测试消息",
            "请介绍一下你的功能",
            "谢谢你的回答"
        ]
        
        for agent in test_agents:
            agent_id = agent.get("id")
            agent_name = agent.get("title", "Unknown")
            
            print(f"\n🎯 测试Agent: {agent_name}")
            print("-" * 40)
            
            # 创建会话
            success, session_id = self.create_session(agent_id, f"自动测试会话_{int(time.time())}")
            if not success:
                continue
            
            # 发送测试消息
            for i, message in enumerate(test_messages, 1):
                print(f"\n📤 发送消息 {i}: {message}")
                success, answer = self.send_message(agent_id, session_id, message)
                
                if success and answer:
                    print(f"📥 收到回复: {answer[:100]}...")
                else:
                    print("❌ 消息发送失败")
                
                time.sleep(1)  # 避免请求过快
            
            # 删除测试会话
            if self.delete_session(agent_id, session_id):
                print("✅ 测试会话已清理")
            else:
                print("⚠️ 测试会话清理失败")
            
            print(f"✅ Agent {agent_name} 测试完成")

    def run_session_mode(self) -> None:
        """会话管理测试模式"""
        print("🚀 开始完整会话管理测试")
        print("=" * 80)
        
        # 获取Agent列表
        success, canvases = self.get_canvas_list()
        if not success:
            print("❌ 无法获取Canvas列表")
            return
        
        # 过滤出真正的Agent
        agents = [c for c in canvases if c.get("is_virtual", False)]
        if not agents:
            print("❌ 没有找到可用的Agent")
            return
        
        # 选择第一个Agent进行测试
        test_agent = agents[0]
        agent_id = test_agent.get("id")
        agent_name = test_agent.get("title", "Unknown")
        
        print(f"🎯 使用Agent进行测试: {agent_name} (ID: {agent_id})")
        
        # 1. 创建会话
        print(f"\n🆕 创建新会话...")
        success, session_id = self.create_session(agent_id, f"生命周期测试会话_{int(time.time())}")
        if not success:
            return
        
        # 2. 发送测试消息
        print(f"\n💬 发送测试消息...")
        success, response = self.send_message(agent_id, session_id, "你好，这是一个测试消息")
        if success:
            print(f"✅ 收到回复: {response[:100]}...")
        else:
            print("⚠️ 消息发送失败，但继续测试会话管理功能...")
        
        # 3. 获取会话列表验证
        print(f"\n📜 获取会话列表验证...")
        success, sessions = self.list_sessions(agent_id)
        if success:
            found_session = any(s.get("id") == session_id for s in sessions)
            if found_session:
                print("✅ 在列表中找到新创建的会话")
            else:
                print("❌ 在列表中未找到新创建的会话")
        
        # 4. 再次发送消息验证会话仍然有效
        print(f"\n💬 发送第二条消息验证会话...")
        success, response = self.send_message(agent_id, session_id, "这是第二条测试消息")
        if success:
            print("✅ 会话仍可正常对话")
        
        # 5. 删除会话
        print(f"\n🗑️ 删除测试会话...")
        success = self.delete_session(agent_id, session_id)
        if success:
            print("✅ 会话删除成功")
        else:
            print("❌ 会话删除失败")
        
        # 6. 验证删除
        print(f"\n🔍 验证会话删除...")
        success, sessions_after_delete = self.list_sessions(agent_id)
        if success:
            still_exists = any(s.get("id") == session_id for s in sessions_after_delete)
            if not still_exists:
                print("✅ 会话已成功删除")
            else:
                print("❌ 会话仍然存在")
        
        print("\n✅ 完整会话生命周期测试完成")
        
        # 输出测试总结
        self.print_test_summary()
    
    def print_test_summary(self):
        """打印测试总结"""
        if not self.test_results:
            return
            
        print("\n" + "=" * 60)
        print("📊 测试结果总结")
        print("=" * 60)
        
        total_tests = len(self.test_results)
        passed_tests = sum(1 for result in self.test_results if result["success"])
        failed_tests = total_tests - passed_tests
        
        print(f"总测试数: {total_tests}")
        print(f"通过: {passed_tests} ✅")
        print(f"失败: {failed_tests} ❌")
        if total_tests > 0:
            print(f"成功率: {(passed_tests/total_tests*100):.1f}%")
        
        if failed_tests > 0:
            print(f"\n❌ 失败的测试:")
            for result in self.test_results:
                if not result["success"]:
                    print(f"  - {result['test_name']}: {result['message']}")


def main():
    parser = argparse.ArgumentParser(description="Canvas对话系统完整测试脚本")
    parser.add_argument("--mode", type=str, default="list", 
                       choices=["list", "interactive", "auto", "session"],
                       help="测试模式: list(列表), interactive(交互), auto(自动), session(会话管理)")
    parser.add_argument("--base-url", type=str, default="http://localhost:9380",
                       help="RAGFlow服务器地址")
    parser.add_argument("--api-token", type=str, help="API Token")
    
    args = parser.parse_args()
    
    print("Canvas对话系统完整测试脚本")
    print(f"功能：列出Canvas、创建会话、进行对话、会话管理")
    print(f"\n测试配置:")
    print(f"  - 服务器地址: {args.base_url}")
    print(f"  - 测试模式: {args.mode}")
    print()
    
    # 获取API Token
    api_token = args.api_token
    if not api_token:
        api_token = input("请输入API Token: ").strip()
    
    if not api_token:
        print("❌ API Token不能为空")
        return
    
    # 创建测试器
    tester = CanvasCompleteTester(api_token, args.base_url)
    
    # 根据模式运行测试
    if args.mode == "list":
        tester.run_list_mode()
    elif args.mode == "interactive":
        tester.run_interactive_mode()
    elif args.mode == "auto":
        tester.run_auto_mode()
    elif args.mode == "session":
        tester.run_session_mode()


if __name__ == "__main__":
    main()
