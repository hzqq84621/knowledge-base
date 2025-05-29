import { ReactComponent as AssistantIcon } from '@/assets/svg/assistant.svg';
import { MessageType } from '@/constants/chat';
import { useSetModalState } from '@/hooks/common-hooks';
import { IReference, IReferenceChunk } from '@/interfaces/database/chat';
import classNames from 'classnames';
import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';

import {
  useFetchDocumentInfosByIds,
  useFetchDocumentThumbnailsByIds,
} from '@/hooks/document-hooks';
import { IRegenerateMessage, IRemoveMessageById } from '@/hooks/logic-hooks';
import { IMessage } from '@/pages/chat/interface';
import MarkdownContent from '@/pages/chat/markdown-content';
import { getExtension, isImage } from '@/utils/document-util';
import { downloadDocument } from '@/utils/file-util';
import { DownloadOutlined } from '@ant-design/icons';
import { Avatar, Button, Flex, List, Typography, message } from 'antd';
import FileIcon from '../file-icon';
import IndentedTreeModal from '../indented-tree/modal';
import NewDocumentLink from '../new-document-link';
import { useTheme } from '../theme-provider';
import styles from './index.less';

const { Text } = Typography;

interface IProps extends Partial<IRemoveMessageById>, IRegenerateMessage {
  item: IMessage;
  reference: IReference;
  loading?: boolean;
  sendLoading?: boolean;
  visibleAvatar?: boolean;
  nickname?: string;
  avatar?: string;
  avatarDialog?: string | null;
  clickDocumentButton?: (documentId: string, chunk: IReferenceChunk) => void;
  index: number;
  showLikeButton?: boolean;
  showLoudspeaker?: boolean;
}

const MessageItem = ({
  item,
  reference,
  loading = false,
  avatar,
  avatarDialog,
  sendLoading = false,
  clickDocumentButton,
  index,
  removeMessageById,
  regenerateMessage,
  showLikeButton = true,
  showLoudspeaker = true,
  visibleAvatar = true,
}: IProps) => {
  const { theme } = useTheme();
  const isAssistant = item.role === MessageType.Assistant;
  const isUser = item.role === MessageType.User;
  const { data: documentList, setDocumentIds } = useFetchDocumentInfosByIds();
  const { data: documentThumbnails, setDocumentIds: setIds } =
    useFetchDocumentThumbnailsByIds();
  const { visible, hideModal, showModal } = useSetModalState();
  const [clickedDocumentId, setClickedDocumentId] = useState('');

  // 引用处理逻辑
  const effectiveReference = useMemo(() => {
    console.log(`[MessageItem] Processing reference for message ${item.id}:`, {
      incomingReference: reference,
      messageReference: item.reference,
      referenceType: reference
        ? Array.isArray(reference)
          ? 'array'
          : typeof reference
        : 'none',
      messageReferenceType: item.reference
        ? Array.isArray(item.reference)
          ? 'array'
          : typeof item.reference
        : 'none',
    });

    // 按优先级处理引用数据

    // 1. 优先使用外部传入的reference参数(已格式化为doc_aggs对象)
    if (
      reference?.doc_aggs &&
      Array.isArray(reference.doc_aggs) &&
      reference.doc_aggs.length > 0
    ) {
      console.log(
        `[MessageItem] Using incoming reference with doc_aggs for message ${item.id}:`,
        reference.doc_aggs.length,
      );
      return reference;
    }

    // 2. 处理外部传入的数组形式reference
    if (Array.isArray(reference) && reference.length > 0) {
      // 检查数组中的第一个元素，判断是否需要进一步处理
      if (reference.length > 0 && reference[0]) {
        // 如果数组元素中直接包含doc_id或doc_name等字段，说明直接是文档引用
        if (reference[0].doc_id || reference[0].doc_name) {
          console.log(
            `[MessageItem] Using incoming array of document references for message ${item.id}:`,
            reference.length,
          );
          return { doc_aggs: reference };
        }
        // 如果数组元素中包含doc_aggs字段，需要提取所有doc_aggs合并
        else if (
          reference[0].doc_aggs &&
          Array.isArray(reference[0].doc_aggs)
        ) {
          const allDocAggs = reference.reduce((acc, ref) => {
            return [...acc, ...(ref.doc_aggs || [])];
          }, []);
          console.log(
            `[MessageItem] Extracted and combined ${allDocAggs.length} doc_aggs from array references for message ${item.id}`,
          );
          return { doc_aggs: allDocAggs };
        }
      }

      console.log(
        `[MessageItem] Converting incoming array reference for message ${item.id}:`,
        reference.length,
      );
      return { doc_aggs: reference };
    }

    // 3. 处理消息自身的数组形式reference (新格式)
    if (Array.isArray(item.reference) && item.reference.length > 0) {
      console.log(
        `[MessageItem] Using message's own array reference for message ${item.id}:`,
        item.reference.length,
      );
      return { doc_aggs: item.reference };
    }

    // 4. 处理消息自身的对象形式reference
    if (
      item.reference &&
      typeof item.reference === 'object' &&
      !Array.isArray(item.reference)
    ) {
      // 如果已经有doc_aggs格式，直接使用
      if (item.reference.doc_aggs) {
        console.log(
          `[MessageItem] Using message's own doc_aggs reference for message ${item.id}:`,
          item.reference.doc_aggs.length,
        );
        return item.reference;
      }

      // 如果是单个文档对象，转换为数组格式
      console.log(
        `[MessageItem] Converting single document reference for message ${item.id}:`,
        item.reference,
      );
      return { doc_aggs: [item.reference] };
    }

    // 5. 处理字符串类型的reference（需要解析）
    if (item.reference && typeof item.reference === 'string') {
      try {
        const parsedReference = JSON.parse(item.reference);
        console.log(
          `[MessageItem] Parsed string reference for message ${item.id}:`,
          parsedReference,
        );

        if (Array.isArray(parsedReference)) {
          return { doc_aggs: parsedReference };
        } else if (parsedReference.doc_aggs) {
          return parsedReference;
        } else if (parsedReference) {
          return { doc_aggs: [parsedReference] };
        }
      } catch (error) {
        console.error(
          `[MessageItem] Failed to parse reference for message ${item.id}:`,
          error,
        );
      }
    }

    // 默认返回空引用
    console.log(
      `[MessageItem] No valid reference found for message ${item.id}, using empty array`,
    );
    return { doc_aggs: [] };
  }, [reference, item.reference, item.id]);

  // 检查消息内容是否存在
  if (!item || !item.content) {
    return (
      <div style={{ color: 'red', padding: '10px' }}>消息内容错误或缺失</div>
    );
  }

  const referenceDocumentList = useMemo(() => {
    const docs = effectiveReference?.doc_aggs ?? [];
    console.log(
      `[MessageItem] Final reference document list for message ${item.id}:`,
      {
        count: docs.length,
        sample: docs.length > 0 ? docs[0] : 'none',
      },
    );
    return docs;
  }, [effectiveReference?.doc_aggs, item.id]);

  // 处理文档下载
  const handleDownloadDocument = useCallback(
    async (docId: string, docName: string) => {
      try {
        await downloadDocument({ id: docId, filename: docName });
        message.success(`文档 "${docName}" 下载完成`);
      } catch (error) {
        message.error(`下载文档 "${docName}" 失败`);
        console.error('Download error:', error);
      }
    },
    [],
  );

  const handleUserDocumentClick = useCallback(
    (id: string) => () => {
      setClickedDocumentId(id);
      showModal();
    },
    [showModal],
  );

  const handleRegenerateMessage = useCallback(() => {
    regenerateMessage?.(item);
  }, [regenerateMessage, item]);

  useEffect(() => {
    const ids = item?.doc_ids ?? [];
    if (ids.length) {
      setDocumentIds(ids);
      const documentIds = ids.filter((x) => !(x in documentThumbnails));
      if (documentIds.length) {
        setIds(documentIds);
      }
    }
  }, [item.doc_ids, setDocumentIds, setIds, documentThumbnails]);

  return (
    <div
      className={classNames(styles.messageItem, {
        [styles.messageItemLeft]: item.role === MessageType.Assistant,
        [styles.messageItemRight]: item.role === MessageType.User,
      })}
    >
      <section
        className={classNames(styles.messageItemSection, {
          [styles.messageItemSectionLeft]: item.role === MessageType.Assistant,
          [styles.messageItemSectionRight]: item.role === MessageType.User,
        })}
      >
        <div
          className={classNames(styles.messageItemContent, {
            [styles.messageItemContentReverse]: item.role === MessageType.User,
          })}
        >
          {/* 头像和内容区域 */}
          {visibleAvatar &&
            (item.role === MessageType.User ? (
              <Avatar size={40} src={avatar ?? '/BR.png'} />
            ) : avatarDialog ? (
              <Avatar size={40} src={avatarDialog} />
            ) : (
              <AssistantIcon />
            ))}

          <Flex vertical gap={8} flex={1}>
            {/* 消息内容 */}
            <div
              className={
                item.role === MessageType.Assistant
                  ? theme === 'dark'
                    ? styles.messageTextDark
                    : styles.messageText
                  : styles.messageUserText
              }
            >
              <MarkdownContent
                loading={loading}
                content={item.content}
                reference={effectiveReference}
                clickDocumentButton={clickDocumentButton}
              />
            </div>

            {isAssistant && referenceDocumentList.length > 0 && (
              <List
                bordered
                dataSource={referenceDocumentList}
                renderItem={(refItem: any) => {
                  return (
                    <List.Item>
                      <Flex
                        gap={'small'}
                        align="center"
                        justify="space-between"
                        style={{ width: '100%' }}
                      >
                        <Flex gap={'small'} align="center">
                          <FileIcon
                            id={refItem.doc_id}
                            name={refItem.doc_name}
                          ></FileIcon>

                          <NewDocumentLink
                            documentId={refItem.doc_id}
                            documentName={refItem.doc_name}
                            prefix="document"
                            link={refItem.url}
                          >
                            {refItem.doc_name}
                          </NewDocumentLink>
                        </Flex>

                        <Button
                          type="link"
                          size="small"
                          icon={<DownloadOutlined />}
                          onClick={() =>
                            handleDownloadDocument(
                              refItem.doc_id,
                              refItem.doc_name,
                            )
                          }
                          title={`下载 ${refItem.doc_name}`}
                        >
                          下载
                        </Button>
                      </Flex>
                    </List.Item>
                  );
                }}
              />
            )}
            {isUser && documentList.length > 0 && (
              <List
                bordered
                dataSource={documentList}
                renderItem={(docItem) => {
                  // TODO:
                  // const fileThumbnail =
                  //   documentThumbnails[docItem.id] || documentThumbnails[docItem.id];
                  const fileExtension = getExtension(docItem.name);
                  return (
                    <List.Item>
                      <Flex gap={'small'} align="center">
                        <FileIcon
                          id={docItem.id}
                          name={docItem.name}
                        ></FileIcon>

                        {isImage(fileExtension) ? (
                          <NewDocumentLink
                            documentId={docItem.id}
                            documentName={docItem.name}
                            prefix="document"
                          >
                            {docItem.name}
                          </NewDocumentLink>
                        ) : (
                          <Button
                            type={'text'}
                            onClick={handleUserDocumentClick(docItem.id)}
                          >
                            <Text
                              style={{ maxWidth: '40vw' }}
                              ellipsis={{ tooltip: docItem.name }}
                            >
                              {docItem.name}
                            </Text>
                          </Button>
                        )}
                      </Flex>
                    </List.Item>
                  );
                }}
              />
            )}
          </Flex>
        </div>
      </section>
      {visible && (
        <IndentedTreeModal
          visible={visible}
          hideModal={hideModal}
          documentId={clickedDocumentId}
        ></IndentedTreeModal>
      )}
    </div>
  );
};

export default memo(MessageItem);
