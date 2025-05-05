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
              {!agentId ? (
                <div className={styles.emptyMessage}>{t('selectAgent')}</div>
              ) : messages.length === 0 ? (
                <div className={styles.emptyMessage}>{t('noMessages')}</div>
              ) : (
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
                      reference={message.reference || []}
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
