import MessageInput from '@/components/message-input';
import MessageItem from '@/components/message-item';
import { MessageType } from '@/constants/chat';
import { useTranslate } from '@/hooks/common-hooks';
import { useSendMessageWithSse } from '@/hooks/logic-hooks';
import { useFetchUserInfo } from '@/hooks/user-setting-hooks';
import api from '@/utils/api';
import {
  buildMessageListWithUuid,
  buildMessageUuidWithRole,
} from '@/utils/chat';
import request from '@/utils/request';
import { Flex, Spin, message } from 'antd';
import React, {
  ChangeEventHandler,
  memo,
  useEffect,
  useRef,
  useState,
} from 'react';
import { v4 as uuid } from 'uuid';
import styles from './index.less';

// 新添加的引用映射函数
function mapReferencesToMessages(
  messages: any[],
  canvasData: any,
): Map<string, any> {
  // 创建一个Map来存储消息ID和对应的引用
  const messageReferenceMap = new Map<string, any>();
  console.log('开始映射引用到消息...');

  // 如果没有消息或没有引用，就返回空映射
  if (!messages || messages.length === 0 || !canvasData || !canvasData.dsl) {
    console.log('无消息或引用数据，返回空映射');
    return messageReferenceMap;
  }

  // 获取所有非欢迎消息（通常是用户和助手的交互消息）
  const nonWelcomeMessages = messages.filter(
    (msg: any) =>
      msg.role === MessageType.Assistant &&
      !msg.content.includes('欢迎') &&
      !msg.content.includes('Welcome'),
  );
  console.log(`找到 ${nonWelcomeMessages.length} 条非欢迎消息`);

  // 从Canvas数据中提取引用
  const canvasReferences = canvasData.dsl.references || [];
  console.log(`找到 ${canvasReferences.length} 条引用`);

  if (nonWelcomeMessages.length === 0 || canvasReferences.length === 0) {
    console.log('没有需要映射的消息或引用');
    return messageReferenceMap;
  }

  // 不同情况的处理策略
  if (canvasReferences.length === nonWelcomeMessages.length) {
    // 情况1：引用数量与非欢迎消息数量相同，一对一映射
    console.log('情况1：引用与消息数量相同，一对一映射');
    nonWelcomeMessages.forEach((msg: any, idx: number) => {
      messageReferenceMap.set(msg.id, canvasReferences[idx]);
    });
  } else if (canvasReferences.length > nonWelcomeMessages.length) {
    // 情况2：引用数量多于消息数量，需要智能映射
    console.log('情况2：引用数量多于消息数量，执行智能映射');
    // 简单策略：将多余的引用附加到最后一条消息
    nonWelcomeMessages.forEach((msg: any, idx: number) => {
      if (idx < nonWelcomeMessages.length - 1) {
        // 除最后一条消息外，一对一映射
        messageReferenceMap.set(msg.id, canvasReferences[idx]);
      } else {
        // 最后一条消息获取剩余所有引用
        const remainingRefs = canvasReferences.slice(idx);
        // 合并引用
        const combinedRef = remainingRefs.reduce((combined: any, ref: any) => {
          if (combined.doc_aggs) {
            combined.doc_aggs = [
              ...(combined.doc_aggs || []),
              ...(ref.doc_aggs || []),
            ];
          } else {
            combined = ref;
          }
          return combined;
        }, {});
        messageReferenceMap.set(msg.id, combinedRef);
      }
    });
  } else if (canvasReferences.length === 1 && nonWelcomeMessages.length > 0) {
    // 情况3：单一引用对应多个消息，将引用附加到最后一条消息
    console.log('情况3：单一引用，附加到最后一条消息');
    const lastMsg = nonWelcomeMessages[nonWelcomeMessages.length - 1];
    messageReferenceMap.set(lastMsg.id, canvasReferences[0]);
  } else {
    // 情况4：引用数量少于消息数量，从末尾开始映射
    console.log('情况4：引用数量少于消息数量，从末尾开始映射');
    const startIdx = Math.max(
      0,
      nonWelcomeMessages.length - canvasReferences.length,
    );
    for (let i = 0; i < canvasReferences.length; i++) {
      messageReferenceMap.set(
        nonWelcomeMessages[startIdx + i].id,
        canvasReferences[i],
      );
    }
  }

  console.log(`成功映射 ${messageReferenceMap.size} 个引用到消息`);
  return messageReferenceMap;
}

interface IProps {
  controller: AbortController;
  conversationId: string | null;
  agentId: string | null;
}

const AgentChatContainer = ({
  controller,
  conversationId,
  agentId,
}: IProps) => {
  const { t } = useTranslate('agent');
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [sendLoading, setSendLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const { data: userInfo } = useFetchUserInfo();
  const [currentConversationId, setCurrentConversationId] = useState<
    string | null
  >(conversationId);
  // 新增引用映射状态
  const [messageReferenceMap, setMessageReferenceMap] = useState<
    Map<string, any>
  >(new Map());

  const {
    send,
    answer,
    done,
    stopOutputMessage: stopSse,
  } = useSendMessageWithSse(api.runCanvas);

  const handleInputChange: ChangeEventHandler<HTMLTextAreaElement> = (e) => {
    setValue(e.target.value);
  };

  useEffect(() => {
    console.log(`AgentId 变化为: ${agentId}`);

    setMessages([]);

    if (!conversationId) {
      setCurrentConversationId(null);
    }

    setSendLoading(false);
    setValue('');
  }, [agentId]);

  useEffect(() => {
    if (conversationId) {
      console.log(`加载对话历史: ${conversationId}`);
      setLoading(true);
      setCurrentConversationId(conversationId);

      request
        .get(`/v1/canvas/get/${conversationId}`)
        .then((response) => {
          const data = response.data;
          if (data && data.code === 0 && data.data) {
            console.log(
              '成功加载对话历史',
              data.data.dsl?.messages?.length || 0,
            );
            const canvasMessages = data.data.dsl?.messages || [];
            const processedMessages = buildMessageListWithUuid(canvasMessages);
            setMessages(processedMessages);

            // 更新引用映射
            const newMessageReferenceMap = mapReferencesToMessages(
              processedMessages,
              data.data,
            );
            setMessageReferenceMap(newMessageReferenceMap);
          } else if (data && (data.code === 102 || data.code === 404)) {
            console.warn(`对话不存在: ${conversationId}`);
            setMessages([]);
            message.warning('对话记录不存在或已被删除');
          } else {
            console.warn('对话历史加载失败或为空:', data);
            setMessages([]);
          }
        })
        .catch((error) => {
          console.error('加载对话历史出错:', error);
          setMessages([]);
          message.error('加载对话历史失败');
        })
        .finally(() => {
          setLoading(false);
        });
    } else {
      setMessages([]);
      setCurrentConversationId(null);
    }
  }, [conversationId]);

  const handlePressEnter = async () => {
    const trimmedValue = value.trim();
    if (!trimmedValue) return;
    if (!agentId) {
      console.warn('未选择Agent');
      return;
    }

    const userMessage = {
      id: uuid(),
      content: trimmedValue,
      role: MessageType.User,
    };

    setMessages((prev) => [...prev, userMessage]);
    setValue('');
    setSendLoading(true);

    console.log(
      '发送消息给 Agent:',
      agentId,
      '当前对话ID:',
      currentConversationId,
      '消息:',
      trimmedValue,
    );

    try {
      const params: Record<string, any> = {
        id: agentId,
        message: trimmedValue,
        message_id: userMessage.id,
      };

      if (currentConversationId) {
        params.conversation_id = currentConversationId;
      }

      const response = await send(params, controller);

      if (
        response &&
        (response?.response.status !== 200 || response?.data?.code !== 0)
      ) {
        console.error('发送消息错误:', response?.data?.message || '未知错误');
        setMessages((prev) => prev.filter((msg) => msg.id !== userMessage.id));
        setValue(trimmedValue);
        setSendLoading(false);
      }
    } catch (error) {
      console.error('发送消息失败:', error);
      setMessages((prev) => prev.filter((msg) => msg.id !== userMessage.id));
      setValue(trimmedValue);
      setSendLoading(false);
    }
  };

  const stopOutputMessage = () => {
    stopSse();
    setSendLoading(false);
  };

  useEffect(() => {
    if (answer && typeof answer === 'object') {
      console.log('SSE响应数据块:', JSON.stringify(answer, null, 2));

      // 修复类型问题，使用类型断言处理answer对象
      const answerObj = answer as any;

      if (
        (answerObj.code !== undefined && answerObj.code !== 0) ||
        (answerObj.data &&
          answerObj.data.answer &&
          answerObj.data.answer.startsWith('**ERROR**'))
      ) {
        let errorMessage = answerObj.message || '发生未知错误';
        if (
          answerObj.data &&
          answerObj.data.answer &&
          answerObj.data.answer.startsWith('**ERROR**')
        ) {
          errorMessage = answerObj.data.answer.replace('**ERROR**:', '').trim();
          console.error('SSE Stream Error (内部错误):', errorMessage);
        } else {
          console.error('SSE Stream Error (代码错误):', errorMessage);
        }

        setMessages((prevMessages) => {
          const currentMessages = Array.isArray(prevMessages)
            ? prevMessages
            : [];
          return [
            ...currentMessages,
            {
              id: uuid(),
              role: MessageType.Assistant,
              content: `错误: ${errorMessage}`,
              error: true,
            },
          ];
        });
        setSendLoading(false);
        return;
      }

      const responseData = answerObj.data ? answerObj.data : answerObj;

      let newConversationId = null;
      if (responseData.conversation_id) {
        newConversationId = responseData.conversation_id;
      } else if (answerObj.conversationId) {
        newConversationId = answerObj.conversationId;
      }

      if (newConversationId && currentConversationId === null) {
        console.log('接收到新的对话ID:', newConversationId);
        setCurrentConversationId(newConversationId);
      }

      let answerContent = null;
      let answerReference = null;

      if (responseData.answer && !responseData.running_status) {
        answerContent = responseData.answer;
        answerReference = responseData.reference || [];
      } else if (answerObj.answer && !answerObj.running_status) {
        answerContent = answerObj.answer;
        answerReference = answerObj.reference || [];
      }

      if (answerContent) {
        setMessages((prevMessages) => {
          const currentMessages = Array.isArray(prevMessages)
            ? prevMessages
            : [];
          const lastMessage =
            currentMessages.length > 0
              ? currentMessages[currentMessages.length - 1]
              : null;

          if (lastMessage && lastMessage.error) {
            return [
              ...currentMessages,
              {
                id: uuid(),
                role: MessageType.Assistant,
                content: answerContent,
                reference: answerReference,
              },
            ];
          } else if (
            lastMessage &&
            lastMessage.role === MessageType.Assistant
          ) {
            return currentMessages.map((msg, index) =>
              index === currentMessages.length - 1
                ? { ...msg, content: answerContent, reference: answerReference }
                : msg,
            );
          } else {
            return [
              ...currentMessages,
              {
                id: uuid(),
                role: MessageType.Assistant,
                content: answerContent,
                reference: answerReference,
              },
            ];
          }
        });
      }
    }

    if (done) {
      console.log('SSE流结束，done=true');
      setSendLoading(false);
    }
  }, [answer, done, currentConversationId]);

  return (
    <Flex flex={1} className={styles.agentChatContainer} vertical>
      <Flex flex={1} vertical className={styles.messageContainer}>
        <div>
          <Spin spinning={loading}>
            <div className={styles.messagePlaceholder}>
              {messages.length > 0 && (
                <div className={styles.messageList}>
                  {messages.map((message, i) => (
                    <MessageItem
                      key={buildMessageUuidWithRole(message)}
                      item={message}
                      loading={
                        message.role === MessageType.Assistant &&
                        sendLoading &&
                        messages.length - 1 === i &&
                        !done
                      }
                      nickname={userInfo.nickname}
                      avatar={userInfo.avatar}
                      index={i}
                      sendLoading={
                        sendLoading && messages.length - 1 === i && !done
                      }
                      reference={
                        messageReferenceMap.has(message.id)
                          ? messageReferenceMap.get(message.id)
                          : message.reference || []
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          </Spin>
        </div>
        <div ref={ref} />
      </Flex>

      <MessageInput
        disabled={!agentId || sendLoading}
        sendDisabled={!value.trim() || !agentId || sendLoading}
        sendLoading={sendLoading}
        value={value}
        onInputChange={handleInputChange}
        onPressEnter={handlePressEnter}
        conversationId={currentConversationId || ''}
        createConversationBeforeUploadDocument={() => Promise.resolve('')}
        stopOutputMessage={stopOutputMessage}
      />
    </Flex>
  );
};

export default memo(AgentChatContainer);
