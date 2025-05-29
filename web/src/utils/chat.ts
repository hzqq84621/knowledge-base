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
    // 确保我们拥有正确格式的reference字段
    let reference = msg.reference;

    // 处理不同格式的引用数据
    if (reference) {
      if (typeof reference === 'string') {
        try {
          // 尝试解析字符串形式的引用
          reference = JSON.parse(reference);
          console.log(
            `Parsed reference string for message ${msg.id || 'unknown'}:`,
            reference,
          );
        } catch (e) {
          console.error(
            `Error parsing reference for message ${msg.id || 'unknown'}:`,
            e,
          );
          reference = []; // 如果解析失败，设置为空数组
        }
      }

      // 确保引用是array或保持原有的格式
      if (
        !Array.isArray(reference) &&
        typeof reference === 'object' &&
        !reference.doc_aggs
      ) {
        console.log(
          `Converting reference object to array for message ${msg.id || 'unknown'}:`,
          reference,
        );
        reference = [reference]; // 将单个引用对象转换为数组
      }
    }

    const processedMsg = {
      ...msg,
      id: msg.id || uuid(), // 如果没有ID则生成一个
      reference: reference, // 使用处理后的引用
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
