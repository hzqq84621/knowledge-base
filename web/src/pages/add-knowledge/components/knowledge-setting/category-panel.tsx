import SvgIcon from '@/components/svg-icon';
import { useTranslate } from '@/hooks/common-hooks';
import { useSelectParserList } from '@/hooks/user-setting-hooks';
import { Col, Empty, Row, Typography } from 'antd';
import DOMPurify from 'dompurify';
import camelCase from 'lodash/camelCase';
import { useMemo } from 'react';
import styles from './index.less';
import { TagTabs } from './tag-tabs';
import { ImageMap } from './utils';

const { Text } = Typography;

const CategoryPanel = ({ chunkMethod }: { chunkMethod: string }) => {
  const parserList = useSelectParserList();
  const { t } = useTranslate('knowledgeConfiguration');

  const item = useMemo(() => {
    const item = parserList.find((x) => x.value === chunkMethod);
    if (item) {
      // 使用本地化翻译，如果没有找到对应的翻译则使用原始标签
      const fileTypeKey = `fileType${item.value.charAt(0).toUpperCase() + item.value.slice(1)}`;
      return {
        // 优先使用翻译后的文件类型名称
        title: t(fileTypeKey) || item.label,
        description: t(camelCase(item.value)),
      };
    }
    return { title: '', description: '' };
  }, [parserList, chunkMethod, t]);

  const imageList = useMemo(() => {
    if (chunkMethod in ImageMap) {
      return ImageMap[chunkMethod as keyof typeof ImageMap];
    }
    return [];
  }, [chunkMethod]);

  return (
    <section className={styles.categoryPanelWrapper}>
      {imageList.length > 0 ? (
        <>
          <h5 className="font-semibold text-base mt-0 mb-1">
            {`"${item.title}" ${t('methodTitle')}`}
          </h5>
          <p
            dangerouslySetInnerHTML={{
              __html: DOMPurify.sanitize(item.description),
            }}
          ></p>
          <h5 className="font-semibold text-base mt-4 mb-1">{`"${item.title}" ${t('methodExamples')}`}</h5>
          <Text>{t('methodExamplesDescription')}</Text>
          <Row gutter={[10, 10]} className={styles.imageRow}>
            {imageList.map((x) => (
              <Col span={12} key={x}>
                <SvgIcon
                  name={x}
                  width={'100%'}
                  className={styles.image}
                ></SvgIcon>
              </Col>
            ))}
          </Row>
          {/* 已删除对话示例标题 */}
        </>
      ) : (
        <Empty description={''} image={null}>
          <p>{t('methodEmpty')}</p>
          <SvgIcon name={'chunk-method/chunk-empty'} width={'100%'}></SvgIcon>
        </Empty>
      )}
      {chunkMethod === 'tag' && <TagTabs></TagTabs>}
    </section>
  );
};

export default CategoryPanel;
