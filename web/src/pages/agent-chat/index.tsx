/**
 * Agent聊天页面
 * 该组件是Agent聊天界面的主要容器，包含三个主要部分：
 * 1. 左侧Agent列表：显示所有可用的Agent
 * 2. 中间对话列表：显示当前选中Agent的所有对话
 * 3. 右侧聊天窗口：显示当前选中对话的聊天内容
 *
 * 创建Agent支持权限设置，选择'团队'权限时将自动获取最新团队成员列表并设置共享权限
 */
import { useTheme } from '@/components/theme-provider';
import {
  useCreateAgent,
  useCreateConversation,
  useDeleteAgent,
  useDeleteConversation,
  useFetchAgentList,
  useFetchConversationList,
  useRenameConversation,
} from '@/hooks/agent-hooks';
import { useShowDeleteConfirm, useTranslate } from '@/hooks/common-hooks';
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import {
  Button,
  Card,
  Divider,
  Empty,
  Flex,
  Input,
  Modal,
  Space,
  Spin,
  Typography,
  message,
} from 'antd';
import classNames from 'classnames';
import {
  ChangeEventHandler,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import AgentChatContainer from './agent-chat-container';
import AgentSettingModal from './agent-setting-modal';
import AgentTemplateModal from './agent-template-modal';
import styles from './index.less';
import RenameConversationModal from './rename-conversation-modal';

const { Text } = Typography;

// 用户ID到昵称的映射表
const USER_NICKNAME_MAP: Record<string, string> = {
  // 请根据实际情况添加更多用户ID到昵称的映射
  '38e1025691ff09c8263774d5a89e': '123', // 用户123的ID
  '123456789abcdef': '456', // 用户456的ID
  // 可以继续添加更多映射...
};

// 辅助函数：打印用户ID以便添加到映射表
const logUserIdForMapping = (agent: any) => {
  if (agent && agent.user_id) {
    console.log(
      `发现未映射的用户ID: ${agent.user_id}，请添加到USER_NICKNAME_MAP中`,
    );
  }
};

/**
 * Agent接口定义
 * 描述Agent的基本信息结构
 */
interface IAgent {
  id: string; // Agent唯一标识
  title: string; // Agent名称
  description?: string; // Agent描述（可选）
  avatar?: string; // Agent头像URL（可选）
  catalog?: string; // Agent的catalog标识符（用于关联对话）
}

/**
 * 对话接口定义
 * 描述Agent对话的基本信息结构
 */
interface IConversation {
  id: string; // 对话唯一标识
  title: string; // 对话标题
  agentId?: string; // 对话所属的Agent ID
  display_title?: string; // 对话显示标题
}

const AgentChat = () => {
  // 搜索字符串状态，用于过滤Agent列表
  const [searchString, setSearchString] = useState('');

  // 当前选中的Agent ID
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);

  // 当前选中Agent的catalog值
  const [activeCatalog, setActiveCatalog] = useState<string | null>(null);

  // 当前选中的对话ID
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null);

  // AbortController用于取消请求
  const [controller, setController] = useState(new AbortController());

  // 获取当前主题和翻译函数
  const { theme } = useTheme();
  const { t } = useTranslate('agent');

  // 显示删除确认对话框
  const showDeleteConfirm = useShowDeleteConfirm();

  /**
   * 创建Agent相关钩子
   * 提供模板选择、Agent设置等功能
   */
  const {
    templateModalVisible, // 模板选择对话框可见性
    hideTemplateModal, // 隐藏模板选择对话框
    showTemplateModal, // 显示模板选择对话框
    agentSettingVisible, // Agent设置对话框可见性
    hideAgentSettingModal, // 隐藏Agent设置对话框
    handleTemplateSelect, // 处理模板选择
    loading: createAgentLoading, // 创建Agent过程中的加载状态
    onAgentOk, // Agent创建确认回调
  } = useCreateAgent();

  /**
   * 获取Agent列表相关钩子
   * 提供Agent列表数据和加载状态
   */
  const {
    data: agentList, // Agent列表数据
    loading: fetchAgentLoading, // 获取Agent列表的加载状态
    refetch: refetchAgentList, // 重新获取Agent列表
  } = useFetchAgentList();

  /**
   * 获取对话列表相关钩子
   * 提供对话列表数据和加载状态
   */
  const {
    data: conversationList, // 对话列表数据
    loading: fetchConversationLoading, // 获取对话列表的加载状态
    refetch: refetchConversationList, // 重新获取对话列表
  } = useFetchConversationList(activeCatalog || undefined);

  /**
   * 删除Agent相关钩子
   * 提供删除Agent功能和加载状态
   */
  const {
    loading: deleteAgentLoading, // 删除Agent的加载状态
    deleteAgent, // 删除Agent函数
  } = useDeleteAgent();

  /**
   * 创建新对话相关钩子
   * 提供创建对话功能和加载状态
   */
  const { loading: createConversationLoading, createConversation } =
    useCreateConversation();

  /**
   * 删除对话相关钩子
   * 提供删除对话功能和加载状态
   */
  const { loading: deleteConversationLoading, deleteConversation } =
    useDeleteConversation();

  /**
   * 重命名对话相关钩子
   * 提供重命名对话功能和相关状态
   */
  const {
    loading: renameConversationLoading,
    renameConversation,
    showRenameModalForConversation,
    renameModalVisible,
    hideRenameModal,
    initialTitle,
  } = useRenameConversation();

  /**
   * 添加调试函数，在渲染前打印助理列表的详细信息
   */
  useEffect(() => {
    if (agentList && agentList.length > 0) {
      console.log('=== 调试信息: 助理列表数据 ===');
      agentList.forEach((agent: any, index) => {
        console.log(`助理 ${index + 1}:`, {
          id: agent.id,
          title: agent.title,
          permission: agent.permission,
          is_own: agent.is_own,
          nickname: agent.nickname,
          user_id: agent.user_id,
          tenant_avatar: agent.tenant_avatar,
          is_shared: agent.is_shared,
        });
      });
      console.log(
        '是否有共享助理:',
        agentList.some((agent: any) => agent.permission === 'team'),
      );
      console.log(
        '是否有非自己创建的助理:',
        agentList.some((agent: any) => agent.is_own === false),
      );
    }
  }, [agentList]);

  /**
   * 添加获取用户昵称的辅助函数
   */
  const getUserNickname = useCallback((agent: any) => {
    // 如果agent对象中有nickname字段，直接使用，不再区分是否是自己创建的
    if (agent.nickname) {
      return agent.nickname;
    }

    // 如果USER_NICKNAME_MAP中有映射，使用映射值
    if (agent.user_id && USER_NICKNAME_MAP[agent.user_id]) {
      return USER_NICKNAME_MAP[agent.user_id];
    }

    // 打印未映射的用户ID
    logUserIdForMapping(agent);

    // 没有任何昵称时使用默认值
    return agent.is_own ? '共享中' : '已共享';
  }, []);

  /**
   * 处理搜索输入框变化
   * 更新搜索关键词状态
   */
  const handleInputChange: ChangeEventHandler<HTMLInputElement> = useCallback(
    (e) => {
      setSearchString(e.target.value);
    },
    [],
  );

  /**
   * 修改过滤后的助理列表处理，添加更多调试信息
   */
  const filteredAgentList = useMemo(() => {
    if (!searchString) {
      console.log('未过滤的助理列表数量:', agentList.length);
      return agentList;
    }

    // 根据标题和描述进行过滤
    const filtered = agentList.filter(
      (agent: IAgent) =>
        agent.title.toLowerCase().includes(searchString.toLowerCase()) ||
        (agent.description &&
          agent.description.toLowerCase().includes(searchString.toLowerCase())),
    );
    console.log('过滤后的助理列表数量:', filtered.length);
    return filtered;
  }, [agentList, searchString]);

  /**
   * 处理Agent卡片点击事件
   * 设置当前活动Agent并重置请求控制器
   */
  const handleAgentCardClick = useCallback(
    (agentId: string) => () => {
      // 查找选中的Agent对象
      const selectedAgent = agentList.find((agent) => agent.id === agentId);

      setActiveAgentId(agentId);
      // 提取并设置catalog值
      if (selectedAgent && selectedAgent.catalog) {
        console.log(`选中Agent(${agentId})的catalog: ${selectedAgent.catalog}`);
        setActiveCatalog(selectedAgent.catalog);
      } else {
        console.warn(`选中的Agent(${agentId})没有catalog值`);
        // 如果没有catalog，可以使用agentId的前16位作为fallback
        if (agentId && agentId.length >= 16) {
          const fallbackCatalog = agentId.substring(0, 16);
          console.log(`使用Agent ID前16位作为catalog: ${fallbackCatalog}`);
          setActiveCatalog(fallbackCatalog);
        } else {
          setActiveCatalog(null);
        }
      }

      // 重置当前选中的对话
      setActiveConversationId(null);

      // 创建新的控制器以便取消之前的请求
      setController((pre) => {
        pre.abort();
        return new AbortController();
      });
    },
    [agentList],
  );

  /**
   * 处理对话卡片点击事件
   * 设置当前活动对话
   */
  const handleConversationCardClick = useCallback(
    (conversationId: string) => () => {
      setActiveConversationId(conversationId);
    },
    [],
  );

  /**
   * 创建新对话
   * 使用当前选中的Agent创建一个新的对话
   */
  const handleCreateConversation = useCallback(async () => {
    if (!activeAgentId) {
      message.warning(t('selectAgentFirst'));
      return;
    }

    try {
      console.log(
        `创建新对话，使用Agent ID: ${activeAgentId}, catalog: ${activeCatalog}`,
      );

      const result = await createConversation(
        activeAgentId,
        `新对话 ${conversationList.length + 1}`,
        activeCatalog || undefined, // 传递当前活动catalog，确保新对话与当前Agent关联
      );

      if (result) {
        console.log('成功创建新对话:', result);
        // 创建成功后会自动刷新对话列表，不需要手动添加
        // 选中新创建的会话
        setActiveConversationId(result.id || result.conversation_id);
      }
    } catch (error) {
      console.error('创建新对话失败:', error);
      message.error(t('createConversationFailed'));
    }
  }, [
    activeAgentId,
    activeCatalog,
    conversationList.length,
    createConversation,
    t,
  ]);

  /**
   * 处理对话删除操作
   * 显示确认对话框并执行删除
   */
  const handleDeleteConversation = useCallback(
    (conversationId: string) => (e: React.MouseEvent) => {
      // 阻止冒泡，避免触发对话卡片点击事件
      e.stopPropagation();

      // 显示删除确认对话框
      showDeleteConfirm({
        title: t('confirmDeleteConversation'),
        content: t('confirmDeleteConversationContent'),
        onOk: async () => {
          // 执行删除操作
          const success = await deleteConversation(
            conversationId,
            activeCatalog || undefined,
          );

          // 如果删除的是当前选中的对话，清除选择
          if (success && conversationId === activeConversationId) {
            setActiveConversationId(null);
          }
        },
      });
    },
    [
      showDeleteConfirm,
      deleteConversation,
      activeCatalog,
      activeConversationId,
      t,
    ],
  );

  /**
   * 处理对话重命名操作
   * 打开重命名模态框
   */
  const handleRenameConversation = useCallback(
    (conversation: IConversation) => (e: React.MouseEvent) => {
      // 阻止冒泡，避免触发对话卡片点击事件
      e.stopPropagation();

      // 打开重命名模态框
      showRenameModalForConversation(conversation);
    },
    [showRenameModalForConversation],
  );

  /**
   * 处理重命名提交
   * 执行对话重命名操作
   */
  const handleRenameOk = useCallback(
    (newTitle: string) => {
      renameConversation(newTitle, activeCatalog || undefined);
    },
    [renameConversation, activeCatalog],
  );

  /**
   * 确认删除Agent的对话框
   * 显示确认对话框并处理删除操作
   */
  const confirmDeleteAgent = useCallback(
    (agentId: string) => {
      Modal.confirm({
        title: t('confirmDelete'),
        content: t('confirmDeleteContent'),
        onOk: async () => {
          await deleteAgent(agentId);
        },
      });
    },
    [deleteAgent, t],
  );

  /**
   * 组件挂载时获取Agent列表
   * 确保页面加载后展示最新数据
   */
  useEffect(() => {
    refetchAgentList().then(() => {
      console.log('获取Agent列表完成');
    });
  }, [refetchAgentList]);

  /**
   * 当activeCatalog变化时刷新对话列表
   */
  useEffect(() => {
    if (activeCatalog) {
      console.log(`catalog值变化，重新获取对话列表: ${activeCatalog}`);
      refetchConversationList();
    }
  }, [activeCatalog, refetchConversationList]);

  /**
   * 查找特定Agent对话
   * 筛选出与当前选中Agent相关的对话
   */
  const filteredConversationList = useMemo(() => {
    if (!activeCatalog) return [];
    console.log(
      `过滤catalog为${activeCatalog}的对话，共${conversationList.length}条`,
    );
    return conversationList;
  }, [activeCatalog, conversationList]);

  return (
    <Flex className={styles.agentChatWrapper}>
      {/* 左侧Agent列表区域 */}
      <Flex className={styles.agentAppWrapper}>
        <Flex flex={1} vertical>
          {/* 创建Agent按钮 */}
          <Button type="primary" onClick={showTemplateModal} block>
            {t('createAgent')}
          </Button>

          <Divider style={{ margin: '12px 0' }}></Divider>

          {/* Agent搜索框 */}
          <Input
            placeholder={t('searchAgent')}
            value={searchString}
            allowClear
            onChange={handleInputChange}
            prefix={<SearchOutlined />}
            style={{ marginBottom: '12px' }}
          />

          {/* Agent列表展示区域 */}
          <Flex className={styles.agentAppContent} vertical gap={10}>
            <Spin
              spinning={fetchAgentLoading}
              wrapperClassName={styles.agentSpin}
            >
              {filteredAgentList && filteredAgentList.length > 0 ? (
                filteredAgentList.map((agent: any) => (
                  <div style={{ position: 'relative' }} key={agent.id}>
                    {(agent.permission === 'team' ||
                      agent.is_own === false) && (
                      <div
                        style={{
                          position: 'absolute',
                          top: '10px',
                          right: '-5px',
                          zIndex: 10,
                          background:
                            agent.is_own === true ? '#1677ff' : '#ff85c0',
                          color: 'white',
                          padding: '4px 12px',
                          fontSize: '14px',
                          fontWeight: 'bold',
                          borderRadius: '4px 0 0 4px',
                          boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
                          minWidth: '55px',
                          textAlign: 'center',
                          height: '24px',
                          lineHeight: '16px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {/* 只显示创建者的昵称 */}
                        {getUserNickname(agent)}
                      </div>
                    )}
                    <Card
                      hoverable
                      className={classNames(styles.agentAppCard, {
                        [theme === 'dark'
                          ? styles.agentAppCardSelectedDark
                          : styles.agentAppCardSelected]:
                          agent.id === activeAgentId,
                      })}
                      onClick={handleAgentCardClick(agent.id)}
                    >
                      <Flex align="center" justify="space-between">
                        <Flex align="center" style={{ overflow: 'hidden' }}>
                          {/* Agent头像 */}
                          <img
                            src={agent.avatar || '/logo.svg'}
                            alt=""
                            className={styles.agentCardIcon}
                            style={{ marginRight: '8px' }}
                          />
                          <Flex
                            vertical
                            style={{ width: 150, overflow: 'hidden' }}
                          >
                            {/* Agent标题 */}
                            <Text
                              className={styles.agentCardTitle}
                              ellipsis={{ tooltip: agent.title }}
                            >
                              {agent.title}
                            </Text>
                            {/* Agent描述 */}
                            <Text
                              type="secondary"
                              className={styles.agentCardDescription}
                              ellipsis={{ tooltip: agent.description }}
                            >
                              {agent.description || t('noDescription')}
                            </Text>
                          </Flex>
                        </Flex>
                        {/* Agent操作按钮 */}
                        <div
                          style={{
                            width: 30,
                            textAlign: 'right',
                            flexShrink: 0,
                          }}
                        >
                          {/* 删除按钮 */}
                          <DeleteOutlined
                            className={styles.agentActionIcon}
                            onClick={(e) => {
                              e.stopPropagation();
                              confirmDeleteAgent(agent.id);
                            }}
                          />
                        </div>
                      </Flex>
                    </Card>
                  </div>
                ))
              ) : (
                <Empty description={t('noAgents')} />
              )}
            </Spin>
          </Flex>
        </Flex>
      </Flex>

      {/* 中间对话列表区域 */}
      <Flex className={styles.agentConversationWrapper}>
        <Flex flex={1} vertical>
          {/* 对话列表标题和新建对话按钮 */}
          <Flex justify="space-between" align="center">
            <span className={styles.agentConversationTitle}>
              {t('conversations')}
            </span>
            <div
              className={styles.addConversationBtn}
              onClick={handleCreateConversation}
            >
              <PlusOutlined />
            </div>
          </Flex>
          <Divider style={{ margin: '12px 0' }}></Divider>

          {/* 对话列表展示区域 */}
          <Flex className={styles.agentConversationContent} vertical gap={8}>
            {activeAgentId ? (
              <Spin spinning={fetchConversationLoading}>
                {filteredConversationList.length > 0 ? (
                  filteredConversationList.map((conversation) => (
                    <Card
                      key={conversation.id}
                      hoverable
                      className={classNames(styles.agentConversationCard, {
                        [styles.agentConversationCardSelected]:
                          conversation.id === activeConversationId,
                      })}
                      onClick={handleConversationCardClick(conversation.id)}
                    >
                      <Flex align="center" justify="space-between">
                        {/* 优先显示display_title，如果没有则尝试处理原始title，移除时间戳部分 */}
                        <span>
                          {conversation.display_title ||
                            (conversation.title &&
                            conversation.title.includes('_')
                              ? conversation.title.split('_')[0]
                              : conversation.title || '新对话')}
                        </span>
                        <Space>
                          <EditOutlined
                            className={styles.agentConversationIcon}
                            onClick={handleRenameConversation(conversation)}
                          />
                          <DeleteOutlined
                            className={styles.agentConversationIcon}
                            onClick={handleDeleteConversation(conversation.id)}
                          />
                        </Space>
                      </Flex>
                    </Card>
                  ))
                ) : (
                  <Empty description={t('noConversations')} />
                )}
              </Spin>
            ) : (
              <Empty description={t('selectAgentFirst')} />
            )}
          </Flex>
        </Flex>
      </Flex>

      {/* 右侧聊天窗口 */}
      <AgentChatContainer
        controller={controller}
        conversationId={activeConversationId}
        agentId={activeAgentId}
      />

      {/* 模板选择模态框 */}
      {templateModalVisible && (
        <AgentTemplateModal
          visible={templateModalVisible}
          hideModal={hideTemplateModal}
          onTemplateSelect={handleTemplateSelect}
        />
      )}

      {/* Agent 设置模态框 */}
      {agentSettingVisible && (
        <AgentSettingModal
          visible={agentSettingVisible}
          hideModal={hideAgentSettingModal}
          onOk={onAgentOk}
          loading={createAgentLoading}
        />
      )}

      {/* 对话重命名模态框 */}
      {renameModalVisible && (
        <RenameConversationModal
          visible={renameModalVisible}
          hideModal={hideRenameModal}
          onOk={handleRenameOk}
          initialTitle={initialTitle}
          loading={renameConversationLoading}
        />
      )}
    </Flex>
  );
};

export default AgentChat;
