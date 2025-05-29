import {
  ChatVariableEnabledField,
  EmptyConversationId,
} from '@/constants/chat';
import { Message } from '@/interfaces/database/chat';
import { IMessage } from '@/pages/chat/interface';
import { v4 as uuid } from 'uuid';

export const isConversationIdExist = (conversationId: string) => {
  return conversationId !== EmptyConversationId && conversationId !== '';
};

export const buildMessageUuid = (message: Partial<Message | IMessage>) => {
  if ('id' in message && message.id) {
    return message.id;
  }
  return uuid();
};

export const buildMessageListWithUuid = (messages: any[]) => {
  if (!messages || !Array.isArray(messages)) {
    return [];
  }

  const processedMessages = messages.map((msg) => {
    // 这里是您现有的处理逻辑
    const processedMsg = {
      ...msg,
      id: msg.id || uuid(), // 如果没有ID则生成一个
      // 其他处理逻辑...
    };

    return processedMsg;
  });

  return processedMessages;
};

export const getConversationId = () => {
  return uuid().replace(/-/g, '');
};

// When rendering each message, add a prefix to the id to ensure uniqueness.
export const buildMessageUuidWithRole = (
  message: Partial<Message | IMessage>,
) => {
  return `${message.role}_${message.id}`;
};

// Preprocess LaTeX equations to be rendered by KaTeX
// ref: https://github.com/remarkjs/react-markdown/issues/785

export const preprocessLaTeX = (content: string) => {
  const blockProcessedContent = content.replace(
    /\\\[([\s\S]*?)\\\]/g,
    (_, equation) => `$$${equation}$$`,
  );
  const inlineProcessedContent = blockProcessedContent.replace(
    /\\\(([\s\S]*?)\\\)/g,
    (_, equation) => `$${equation}$`,
  );
  return inlineProcessedContent;
};

export function replaceThinkToSection(text: string = '') {
  const pattern = /<think>([\s\S]*?)<\/think>/g;

  const result = text.replace(pattern, '<section class="think">$1</section>');

  return result;
}

export function setInitialChatVariableEnabledFieldValue(
  field: ChatVariableEnabledField,
) {
  return field !== ChatVariableEnabledField.MaxTokensEnabled;
}
