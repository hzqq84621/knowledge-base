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

  // 如果没有消息或没有DSL数据，就返回空映射
  if (!messages || messages.length === 0 || !canvasData || !canvasData.dsl) {
    console.log('mapReferencesToMessages: No messages or canvas data', {
      hasMessages: !!messages && messages.length > 0,
      hasCanvasData: !!canvasData,
      hasDsl: !!(canvasData && canvasData.dsl),
    });
    return messageReferenceMap;
  }

  console.log('mapReferencesToMessages: Processing messages with references', {
    messagesCount: messages.length,
  });

  // 首先尝试从消息中直接获取引用（新格式，reference直接在message内）
  let hasReferencesInMessages = false;

  messages.forEach((message: any) => {
    // 处理消息中的引用字段
    if (message && message.id) {
      let msgReference = null;

      // 处理不同格式的引用数据
      if (message.reference) {
        // 如果引用已经是数组
        if (Array.isArray(message.reference) && message.reference.length > 0) {
          msgReference = message.reference;
          console.log(`Found array reference in message ${message.id}:`, {
            length: message.reference.length,
          });
        }
        // 如果引用是对象，但不是数组
        else if (typeof message.reference === 'object') {
          // 如果对象有doc_aggs字段
          if (message.reference.doc_aggs) {
            msgReference = message.reference.doc_aggs;
            console.log(
              `Found doc_aggs object reference in message ${message.id}:`,
              {
                length: message.reference.doc_aggs.length,
              },
            );
          }
          // 如果是单个引用对象
          else {
            msgReference = [message.reference];
            console.log(
              `Found single object reference in message ${message.id}, converted to array`,
            );
          }
        }
        // 如果引用是字符串类型
        else if (typeof message.reference === 'string') {
          try {
            const parsedRef = JSON.parse(message.reference);
            if (Array.isArray(parsedRef)) {
              msgReference = parsedRef;
            } else if (parsedRef.doc_aggs) {
              msgReference = parsedRef.doc_aggs;
            } else {
              msgReference = [parsedRef];
            }
            console.log(`Parsed string reference in message ${message.id}:`, {
              type: Array.isArray(msgReference) ? 'array' : typeof msgReference,
              length: Array.isArray(msgReference) ? msgReference.length : 'n/a',
            });
          } catch (e) {
            console.error(
              `Failed to parse reference string in message ${message.id}:`,
              e,
            );
          }
        }
      }

      // 如果成功提取了引用数据，保存到映射中
      if (msgReference && msgReference.length > 0) {
        messageReferenceMap.set(message.id, msgReference);
        hasReferencesInMessages = true;
        console.log(`Mapped reference to message ${message.id}:`, {
          referenceCount: msgReference.length,
        });
      }
    }
  });

  // 如果在消息中找到了引用，直接返回映射
  if (hasReferencesInMessages) {
    console.log('Successfully mapped references from messages', {
      totalMappings: messageReferenceMap.size,
      messageIds: Array.from(messageReferenceMap.keys()),
    });
    return messageReferenceMap;
  }

  // 如果消息中没有引用，尝试从DSL的reference字段中获取（旧格式）
  const canvasReferences = canvasData.dsl.reference || [];

  console.log('Falling back to DSL references', {
    referencesCount: canvasReferences.length,
    referencesStructure: canvasReferences.slice(0, 2), // 显示前2个引用的结构
  });

  if (canvasReferences.length === 0) {
    return messageReferenceMap;
  }

  // 收集没有message_id的直接引用数据
  const directReferences: any[] = [];

  // 处理新的引用结构：{message_id: string, references: any}
  canvasReferences.forEach((refItem: any, index: number) => {
    // 情况1: 有正确的message_id和references字段
    if (refItem.message_id && refItem.references) {
      // 直接根据message_id映射引用
      messageReferenceMap.set(refItem.message_id, refItem.references);
      console.log(`Mapped reference ${index} to message ${refItem.message_id}`);
    }
    // 情况2: 直接是包含doc_aggs的引用数据对象
    else if (
      refItem.doc_aggs &&
      Array.isArray(refItem.doc_aggs) &&
      refItem.doc_aggs.length > 0
    ) {
      // 记录找到了直接的引用数据
      console.log(`Found direct reference with doc_aggs at index ${index}:`, {
        docCount: refItem.doc_aggs.length,
      });

      // 将这些引用收集起来，后面统一处理
      directReferences.push(refItem);
    } else {
      console.log(
        `Reference ${index} missing message_id or references:`,
        refItem,
      );
    }
  });

  // 处理直接收集的引用数据
  if (directReferences.length > 0) {
    console.log(
      `Processing ${directReferences.length} direct references without message_id`,
    );

    // 获取所有助手消息，排除欢迎消息
    const assistantMessages = messages.filter(
      (msg) =>
        msg.role === MessageType.Assistant &&
        !msg.content.includes('欢迎') &&
        !msg.content.includes('Welcome'),
    );

    if (assistantMessages.length > 0) {
      console.log(
        `Found ${assistantMessages.length} assistant messages to map references to`,
      );

      // 如果直接引用数量少于或等于助手消息数量，按顺序分配
      if (directReferences.length <= assistantMessages.length) {
        // 从最近的消息开始映射（假设最新的引用对应最新的消息）
        const startIdx = Math.max(
          0,
          assistantMessages.length - directReferences.length,
        );

        for (let i = 0; i < directReferences.length; i++) {
          const targetMsg = assistantMessages[startIdx + i];
          if (targetMsg && targetMsg.id) {
            messageReferenceMap.set(targetMsg.id, directReferences[i].doc_aggs);
            console.log(
              `Mapped direct reference ${i} to assistant message ${targetMsg.id}`,
            );
          }
        }
      }
      // 如果引用数量多于消息数量，将所有引用合并分配给最后一条消息
      else {
        const lastMsg = assistantMessages[assistantMessages.length - 1];

        // 合并所有引用的doc_aggs
        const allDocAggs = directReferences.reduce((acc, ref) => {
          return [...acc, ...(ref.doc_aggs || [])];
        }, []);

        console.log(
          `Mapped ${allDocAggs.length} combined references to last message ${lastMsg.id}`,
        );
        messageReferenceMap.set(lastMsg.id, allDocAggs);
      }
    }
  }

  // 如果新结构没有数据，回退到旧的映射逻辑（兼容性处理）
  if (messageReferenceMap.size === 0) {
    console.log('No new-style references found, trying legacy format...');

    // 获取所有非欢迎消息（通常是用户和助手的交互消息）
    const nonWelcomeMessages = messages.filter(
      (msg: any) =>
        msg.role === MessageType.Assistant &&
        !msg.content.includes('欢迎') &&
        !msg.content.includes('Welcome'),
    );

    // 兼容旧的引用结构 - 从dsl.references获取
    const legacyReferences = canvasData.dsl.references || [];

    console.log('Legacy mapping attempt:', {
      nonWelcomeMessagesCount: nonWelcomeMessages.length,
      legacyReferencesCount: legacyReferences.length,
    });

    if (nonWelcomeMessages.length === 0 || legacyReferences.length === 0) {
      return messageReferenceMap;
    }

    // 简化的映射策略：按时间顺序映射
    if (legacyReferences.length <= nonWelcomeMessages.length) {
      // 从最后开始映射
      const startIdx = Math.max(
        0,
        nonWelcomeMessages.length - legacyReferences.length,
      );
      for (let i = 0; i < legacyReferences.length; i++) {
        const message = nonWelcomeMessages[startIdx + i];
        if (message && message.id) {
          messageReferenceMap.set(message.id, legacyReferences[i]);
          console.log(`Legacy mapped reference ${i} to message ${message.id}`);
        }
      }
    } else {
      // 如果引用多于消息，将所有引用合并到最后一条消息
      const lastMsg = nonWelcomeMessages[nonWelcomeMessages.length - 1];
      const combinedRef = legacyReferences.reduce((combined: any, ref: any) => {
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
      messageReferenceMap.set(lastMsg.id, combinedRef);
    }
  }

  console.log('Final reference mapping:', {
    totalMappings: messageReferenceMap.size,
    mappedMessageIds: Array.from(messageReferenceMap.keys()),
  });

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
            // 处理可能是字符串形式的DSL
            let dsl = data.data.dsl;
            if (typeof dsl === 'string') {
              try {
                dsl = JSON.parse(dsl);
              } catch (error) {
                console.error('Failed to parse DSL JSON:', error);
                dsl = {
                  components: {},
                  history: [],
                  messages: [],
                  reference: [],
                  path: [],
                  answer: [],
                };
              }
            }

            const canvasMessages = dsl?.messages || [];
            const processedMessages = buildMessageListWithUuid(canvasMessages);

            // 再次检查，确保状态更新时对话没有切换
            if (loadingConversationRef.current === conversationId) {
              setMessages(processedMessages);

              // 更新引用映射 - 使用处理过的DSL
              const canvasDataWithParsedDsl = {
                ...data.data,
                dsl: dsl,
              };
              // 添加更多详细的日志，以便于检查消息和引用的结构
              console.log(
                'Processed messages before mapping:',
                processedMessages.map((msg) => ({
                  id: msg.id,
                  role: msg.role,
                  hasReference: !!msg.reference,
                  referenceType: msg.reference
                    ? Array.isArray(msg.reference)
                      ? 'array'
                      : typeof msg.reference
                    : 'none',
                })),
              );

              const newMessageReferenceMap = mapReferencesToMessages(
                processedMessages,
                canvasDataWithParsedDsl,
              );

              // 详细输出映射结果，便于调试
              console.log(
                'Reference mapping details:',
                Array.from(newMessageReferenceMap.entries()).map(
                  ([msgId, ref]) => ({
                    messageId: msgId,
                    referenceType: Array.isArray(ref) ? 'array' : typeof ref,
                    referenceCount: Array.isArray(ref)
                      ? ref.length
                      : ref && typeof ref === 'object' && ref.doc_aggs
                        ? ref.doc_aggs.length
                        : 0,
                  }),
                ),
              );

              setMessageReferenceMap(newMessageReferenceMap);

              console.log('Canvas data loaded:', {
                conversationId,
                messagesCount: processedMessages.length,
                referencesCount: dsl?.reference?.length || 0,
                referenceMapSize: newMessageReferenceMap.size,
              });
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
        console.log('Received answer with reference:', answerReference);
      } else if (answerObj.answer && !answerObj.running_status) {
        answerContent = answerObj.answer;
        answerReference = answerObj.reference || [];
        console.log(
          'Received answer with reference from answerObj:',
          answerReference,
        );
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
                        // 添加调试信息，帮助排查引用数据
                        data-has-reference={
                          !!message.reference ||
                          messageReferenceMap.has(message.id)
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
