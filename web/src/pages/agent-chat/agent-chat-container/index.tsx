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
import { Flex, Spin } from 'antd';
import React, {
  ChangeEventHandler,
  memo,
  useEffect,
  useRef,
  useState,
} from 'react';
import { v4 as uuid } from 'uuid';
import styles from './index.less';

// 引用映射函数
function mapReferencesToMessages(
  messages: any[],
  canvasData: any,
): Map<string, any> {
  const messageReferenceMap = new Map<string, any>();

  // 如果没有消息或没有引用，就返回空映射
  if (!messages || messages.length === 0 || !canvasData || !canvasData.dsl) {
    return messageReferenceMap;
  }

  // 获取所有非欢迎消息（通常是用户和助手的交互消息）
  const nonWelcomeMessages = messages.filter(
    (msg: any) =>
      msg.role === MessageType.Assistant &&
      !msg.content.includes('欢迎') &&
      !msg.content.includes('Welcome'),
  );

  // 从Canvas数据中提取引用
  const canvasReferences = canvasData.dsl.references || [];

  if (nonWelcomeMessages.length === 0 || canvasReferences.length === 0) {
    return messageReferenceMap;
  }

  // 不同情况的处理策略
  if (canvasReferences.length === nonWelcomeMessages.length) {
    // 情况1：引用数量与非欢迎消息数量相同，一对一映射
    nonWelcomeMessages.forEach((msg: any, idx: number) => {
      messageReferenceMap.set(msg.id, canvasReferences[idx]);
    });
  } else if (canvasReferences.length > nonWelcomeMessages.length) {
    // 情况2：引用数量多于消息数量，需要智能映射
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
    const lastMsg = nonWelcomeMessages[nonWelcomeMessages.length - 1];
    messageReferenceMap.set(lastMsg.id, canvasReferences[0]);
  } else {
    // 情况4：引用数量少于消息数量，从末尾开始映射
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
  // 引用映射状态
  const [messageReferenceMap, setMessageReferenceMap] = useState<
    Map<string, any>
  >(new Map());

  // 添加加载状态追踪，防止竞态条件
  const [isLoadingConversation, setIsLoadingConversation] = useState(false);
  const loadingConversationRef = useRef<string | null>(null);

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
    // Agent变化时清空所有状态并取消任何正在进行的加载
    setMessages([]);
    setMessageReferenceMap(new Map());
    setCurrentConversationId(null);
    setSendLoading(false);
    setValue('');
    setIsLoadingConversation(false);
    loadingConversationRef.current = null;
  }, [agentId]);

  // 组件卸载时清理状态
  useEffect(() => {
    return () => {
      setIsLoadingConversation(false);
      loadingConversationRef.current = null;
    };
  }, []);

  useEffect(() => {
    // 防止竞态条件：如果已经在加载某个对话，忽略其他请求
    if (
      isLoadingConversation &&
      loadingConversationRef.current === conversationId
    ) {
      return;
    }

    if (conversationId) {
      // 设置加载状态并记录当前加载的对话ID
      setIsLoadingConversation(true);
      loadingConversationRef.current = conversationId;
      setLoading(true);

      // 重要：对话切换时立即清空当前消息状态
      setMessages([]);
      setMessageReferenceMap(new Map());

      setCurrentConversationId(conversationId);

      request
        .get(`/v1/canvas/get/${conversationId}`)
        .then((response) => {
          // 检查这个响应是否还对应当前要加载的对话
          if (loadingConversationRef.current !== conversationId) {
            return;
          }

          const data = response.data;
          if (data && data.code === 0 && data.data) {
            const canvasMessages = data.data.dsl?.messages || [];
            const processedMessages = buildMessageListWithUuid(canvasMessages);

            // 再次检查，确保状态更新时对话没有切换
            if (loadingConversationRef.current === conversationId) {
              setMessages(processedMessages);

              // 更新引用映射
              const newMessageReferenceMap = mapReferencesToMessages(
                processedMessages,
                data.data,
              );
              setMessageReferenceMap(newMessageReferenceMap);
            }
          } else {
            // 确保异常情况下也清空消息（只有当前对话）
            if (loadingConversationRef.current === conversationId) {
              setMessages([]);
            }
          }
        })
        .catch((error) => {
          // 确保错误情况下也清空消息（只有当前对话）
          if (loadingConversationRef.current === conversationId) {
            setMessages([]);
          }
        })
        .finally(() => {
          // 只有当前对话加载完成才清除加载状态
          if (loadingConversationRef.current === conversationId) {
            setLoading(false);
            setIsLoadingConversation(false);
            loadingConversationRef.current = null;
          }
        });
    } else {
      // 当没有conversationId时，也要清空消息
      setMessages([]);
      setMessageReferenceMap(new Map());
      setCurrentConversationId(null);
      setIsLoadingConversation(false);
      loadingConversationRef.current = null;
    }
  }, [conversationId]);

  const handlePressEnter = async () => {
    const trimmedValue = value.trim();
    if (!trimmedValue) return;
    if (!agentId) {
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

    try {
      const params: Record<string, any> = {
        id: currentConversationId || agentId, // 优先使用对话ID作为目标Canvas
        message: trimmedValue,
        message_id: userMessage.id,
      };

      const response = await send(params, controller);

      if (
        response &&
        (response?.response.status !== 200 || response?.data?.code !== 0)
      ) {
        setMessages((prev) => prev.filter((msg) => msg.id !== userMessage.id));
        setValue(trimmedValue);
        setSendLoading(false);
      }
    } catch (error) {
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
      const answerObj = answer as any;
      const responseData = answerObj.data ? answerObj.data : answerObj;

      let newConversationId = null;
      if (responseData.conversation_id) {
        newConversationId = responseData.conversation_id;
      } else if (answerObj.conversationId) {
        newConversationId = answerObj.conversationId;
      }

      if (newConversationId && currentConversationId === null) {
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
                  {messages.map((message, i) => {
                    return (
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
                    );
                  })}
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
