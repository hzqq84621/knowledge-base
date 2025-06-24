#!/usr/bin/env python3
"""
RAGFlow知识库检索测试工具
通过API Key获取权限，列出知识库，进行问题检索
"""

import requests
import json

class ChunkAPITester:
    def __init__(self, base_url="http://192.168.120.169:80", token=None):
        self.base_url = base_url.rstrip('/')
        self.session = requests.Session()
        self.token = token
        
        # 设置认证头
        if token:
            self.session.headers.update({
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json"
            })
    
    def get_knowledge_bases(self):
        """获取知识库列表"""
        url = f"{self.base_url}/api/v1/datasets"
        
        try:
            print(f"🔍 正在获取知识库...")
            response = self.session.get(url)
            
            if response.status_code == 200:
                result = response.json()
                if result.get('code') == 0:
                    data_list = result.get('data', [])
                    return data_list
                else:
                    print(f"   API错误: {result.get('message')}")
                    return "AUTH_REQUIRED" if result.get('code') == 401 else []
            else:
                print(f"   HTTP错误: {response.status_code}")
                return "AUTH_REQUIRED" if response.status_code == 401 else []
                
        except Exception as e:
            print(f"   请求异常: {e}")
            return []
    
    def test_retrieval(self, kb_id, question, top_k=5):
        """测试检索功能"""
        url = f"{self.base_url}/api/v1/retrieval"
        
        # 检索参数
        data = {
            "question": question,
            "dataset_ids": [kb_id],
            "document_ids": [],
            "page": 1,
            "page_size": 30,
            "similarity_threshold": 0.2,
            "vector_similarity_weight": 0.3,
            "top_k": top_k,
            "rerank_id": None,
            "keyword": False
        }
        
        try:
            print(f"🔍 检索中...")
            response = self.session.post(url, json=data)
            
            if response.status_code == 200:
                result = response.json()
                if result.get('code') == 0:
                    chunks_data = result.get('data', {}).get('chunks', [])
                    print(f"   找到 {len(chunks_data)} 个相关块")
                    return result
                else:
                    return {"error": f"API错误: {result.get('message', '未知错误')}"}
            else:
                return {"error": f"HTTP {response.status_code}"}
                    
        except Exception as e:
            return {"error": f"请求异常: {e}"}

def select_from_list(items, item_type="项目"):
    """从列表中选择一个项目"""
    if not items:
        print(f"❌ 没有可用的{item_type}")
        return None
    
    print(f"\n📋 {item_type}列表:")
    print("-" * 50)
    
    for i, item in enumerate(items, 1):
        name = item.get('name') or item.get('title') or f"未知{item_type}"
        description = item.get('description', '')
        
        print(f"  {i}. {name}")
        if description:
            desc_short = description[:50] + "..." if len(description) > 50 else description
            print(f"     {desc_short}")
        print()
    
    while True:
        try:
            choice = input(f"选择{item_type} (1-{len(items)}, q退出): ").strip()
            
            if choice.lower() == 'q':
                return None
            
            index = int(choice) - 1
            if 0 <= index < len(items):
                selected = items[index]
                name = selected.get('name') or selected.get('title') or '未知'
                print(f"✅ 已选择: {name}")
                return selected
            else:
                print(f"❌ 请输入 1-{len(items)} 的数字")
        
        except ValueError:
            print("❌ 请输入有效数字")
        except KeyboardInterrupt:
            print("\n👋 退出")
            return None

def main():
    print("🧪 RAGFlow知识库检索测试工具")
    print("=" * 50)
    
    # 使用提供的API key初始化测试器
    # api_key = "ragflow-VkYjBiYjgwMmI0ZTExZjBiZWJkNjM2Y2"
    api_key = "ragflow-M3MTUyNmMyMTZhZjExZjA5MjBkMjJkZT"
    
    tester = ChunkAPITester(base_url="http://192.168.120.169:80", token=api_key)
    
    print(f"🔑 API Key: {api_key[:20]}...")
    
    try:
        # 1. 获取并选择知识库
        print("\n📚 获取知识库列表...")
        knowledge_bases = tester.get_knowledge_bases()
        
        if knowledge_bases == "AUTH_REQUIRED":
            print("\n❌ API Key认证失败，请检查Key是否正确")
            return
        
        if not knowledge_bases:
            print("\n❌ 无法获取知识库列表")
            return
        
        selected_kb = select_from_list(knowledge_bases, "知识库")
        if not selected_kb:
            print("👋 已退出程序")
            return
        
        kb_id = selected_kb.get('id') or selected_kb.get('kb_id')
        kb_name = selected_kb.get('name') or selected_kb.get('title') or '未知知识库'
        kb_description = selected_kb.get('description', '无描述')
        
        print(f"\n✅ 已选择知识库: {kb_name}")
        print(f"   ID: {kb_id}")
        print(f"   描述: {kb_description}")
        
        # 2. 直接进行问题检索（无需选择文档）
        print(f"\n🔍 知识库检索测试")
        print("=" * 50)
        
        question = input("请输入检索问题: ").strip()
        if not question:
            print("❌ 请输入有效问题")
            return
        
        print(f"\n🔍 正在检索: '{question}'")
        retrieval_result = tester.test_retrieval(kb_id, question, top_k=5)
        
        if 'error' not in retrieval_result:
            print(f"✅ 检索成功!")
            
            # 显示检索结果
            chunks_data = retrieval_result.get('data', {}).get('chunks', [])
            print(f"\n📄 找到 {len(chunks_data)} 个相关块:")
            print("=" * 70)
            
            for i, chunk in enumerate(chunks_data, 1):
                print(f"\n🔖 块 #{i}")
                print(f"   相似度: {chunk.get('similarity', 'N/A'):.4f}")
                print(f"   来源文档: {chunk.get('document_keyword', 'N/A')}")
                
                content = chunk.get('content', '')
                if len(content) > 300:
                    content = content[:300] + "..."
                print(f"   内容: {content}")
                
                # 显示高亮匹配部分
                highlight = chunk.get('highlight', '')
                if highlight and highlight != content:
                    if len(highlight) > 300:
                        highlight = highlight[:300] + "..."
                    print(f"   匹配: {highlight}")
                
                print("-" * 50)
        else:
            print(f"❌ 检索失败: {retrieval_result.get('error')}")
        
        print(f"\n🎉 测试完成!")
        
    except KeyboardInterrupt:
        print(f"\n\n👋 用户取消操作")
    except Exception as e:
        print(f"\n❌ 程序出现错误: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()