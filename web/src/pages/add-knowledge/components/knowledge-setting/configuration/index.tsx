// 导入必要的依赖和类型
import { DocumentParserType } from '@/constants/knowledge';
import { useTranslate } from '@/hooks/common-hooks';
import { normFile } from '@/utils/file-util';
import { CaretRightOutlined, PlusOutlined } from '@ant-design/icons';
import {
  Button,
  Collapse,
  Form,
  Input,
  Radio,
  Select,
  Space,
  Upload,
} from 'antd';
import { FormInstance } from 'antd/lib';
import { useEffect, useMemo, useState } from 'react';

// 导入自定义 hooks
import {
  useFetchKnowledgeConfigurationOnMount, // 用于加载知识库配置
  useSubmitKnowledgeConfiguration, // 用于提交知识库配置
} from '../hooks';

// 导入各种文档类型的配置组件
import { AudioConfiguration } from './audio';
import { BookConfiguration } from './book';
import { EmailConfiguration } from './email';
import { LawsConfiguration } from './laws';
import { ManualConfiguration } from './manual';
import { NaiveConfiguration } from './naive';
import { OneConfiguration } from './one';
import { PaperConfiguration } from './paper';
import { PictureConfiguration } from './picture';
import { PresentationConfiguration } from './presentation';
import { QAConfiguration } from './qa';
import { ResumeConfiguration } from './resume';
import { TableConfiguration } from './table';
import { TagConfiguration } from './tag';

import styles from '../index.less';

// 文档解析器类型到对应配置组件的映射
const ConfigurationComponentMap = {
  [DocumentParserType.Naive]: NaiveConfiguration, // 简单文档配置
  [DocumentParserType.Qa]: QAConfiguration, // 问答文档配置
  [DocumentParserType.Resume]: ResumeConfiguration, // 简历文档配置
  [DocumentParserType.Manual]: ManualConfiguration, // 手册文档配置
  [DocumentParserType.Table]: TableConfiguration, // 表格文档配置
  [DocumentParserType.Paper]: PaperConfiguration, // 论文文档配置
  [DocumentParserType.Book]: BookConfiguration, // 书籍文档配置
  [DocumentParserType.Laws]: LawsConfiguration, // 法律文档配置
  [DocumentParserType.Presentation]: PresentationConfiguration, // 演示文档配置
  [DocumentParserType.Picture]: PictureConfiguration, // 图片文档配置
  [DocumentParserType.One]: OneConfiguration, // 单一文档配置
  [DocumentParserType.Audio]: AudioConfiguration, // 音频文档配置
  [DocumentParserType.Email]: EmailConfiguration, // 邮件文档配置
  [DocumentParserType.Tag]: TagConfiguration, // 标签文档配置
  //[DocumentParserType.KnowledgeGraph]: KnowledgeGraphConfiguration, // 知识图谱文档配置
};

// 空组件，当没有选择解析器类型时显示
function EmptyComponent() {
  return <div></div>;
}

// 配置表单组件
export const ConfigurationForm = ({ form }: { form: FormInstance }) => {
  // 获取提交相关的方法和状态
  const { submitKnowledgeConfiguration, submitLoading, navigateToDataset } =
    useSubmitKnowledgeConfiguration(form);
  // 获取国际化翻译函数
  const { t } = useTranslate('knowledgeConfiguration');

  // 状态管理
  const [finalParserId, setFinalParserId] = useState<DocumentParserType>();
  // 折叠面板状态
  const [expandAdvanced, setExpandAdvanced] = useState(false);
  // 加载知识库详情
  const knowledgeDetails = useFetchKnowledgeConfigurationOnMount(form);
  // 监听解析器ID的变化
  const parserId: DocumentParserType = Form.useWatch('parser_id', form);
  // 监听权限变化
  const permission = Form.useWatch('permission', form);

  // 获取文件类型选项
  const chunkMethodOptions = useMemo(() => {
    // 定义要隐藏的文件类型列表
    const hiddenTypes = [
      // 在这里添加您想要隐藏的类型
      DocumentParserType.KnowledgeGraph, // 知识图谱文档配置
      DocumentParserType.Audio, // 音频类型
      DocumentParserType.Email, // 邮件类型
      DocumentParserType.Tag, // 标签类型
      // 您可以根据需要添加或移除类型
    ];

    return (
      Object.values(DocumentParserType)
        // 过滤掉不想显示的类型
        .filter((value) => !hiddenTypes.includes(value))
        .map((value) => {
          // 将枚举值转换为对应的本地化key
          const key = `fileType${value.charAt(0).toUpperCase() + value.slice(1)}`;
          return {
            // 使用本地化翻译，如果没有找到对应的翻译则使用原始值首字母大写
            label:
              t(key) ||
              (value === DocumentParserType.KnowledgeGraph
                ? 'Knowledge Graph'
                : value.charAt(0).toUpperCase() + value.slice(1)),
            value: value,
          };
        })
    );
  }, [t]);

  // 根据解析器ID动态获取对应的配置组件
  const ConfigurationComponent = useMemo(() => {
    return finalParserId
      ? ConfigurationComponentMap[finalParserId]
      : EmptyComponent;
  }, [finalParserId]);

  // 当解析器ID变化时更新状态
  useEffect(() => {
    setFinalParserId(parserId);
  }, [parserId]);

  // 当知识库详情加载完成后更新解析器ID
  useEffect(() => {
    setFinalParserId(knowledgeDetails.parser_id as DocumentParserType);
  }, [knowledgeDetails.parser_id]);

  return (
    <Form form={form} name="validateOnly" layout="vertical" autoComplete="off">
      {/* 知识库名称配置 */}
      <Form.Item name="name" label={t('name')} rules={[{ required: true }]}>
        <Input />
      </Form.Item>

      {/* 知识库图片上传配置 */}
      <Form.Item
        name="avatar"
        label={t('photo')}
        valuePropName="fileList"
        getValueFromEvent={normFile}
      >
        <Upload
          listType="picture-card"
          maxCount={1}
          beforeUpload={() => false}
          showUploadList={{ showPreviewIcon: false, showRemoveIcon: false }}
        >
          <button style={{ border: 0, background: 'none' }} type="button">
            <PlusOutlined />
            <div style={{ marginTop: 8 }}>{t('upload')}</div>
          </button>
        </Upload>
      </Form.Item>

      {/* 知识库描述配置 */}
      <Form.Item name="description" label={t('description')}>
        <Input />
      </Form.Item>

      {/* 权限设置 - 简化为单选按钮形式 */}
      <Form.Item
        name="permission"
        label={t('permissions') || '权限'}
        rules={[{ required: true }]}
      >
        <Radio.Group>
          <Radio value="me">只有我</Radio>
          <Radio value="team">团队</Radio>
        </Radio.Group>
      </Form.Item>

      {/* 切片方法选择 - 始终可见 */}
      <Form.Item
        name="parser_id"
        label={t('chunkMethod')}
        rules={[{ required: true }]}
      >
        <Select
          placeholder={t('chunkMethodPlaceholder')}
          options={chunkMethodOptions}
        />
      </Form.Item>

      {/* 高级配置 - 默认折叠 */}
      <Collapse
        bordered={false}
        expandIcon={({ isActive }) => (
          <CaretRightOutlined rotate={isActive ? 90 : 0} />
        )}
        onChange={(key) => setExpandAdvanced(key.length > 0)}
      >
        <Collapse.Panel header={t('advancedSettings') || '参数配置'} key="1">
          {/* 动态加载的文档类型特定配置 */}
          <ConfigurationComponent></ConfigurationComponent>
        </Collapse.Panel>
      </Collapse>

      {/* 表单操作按钮 */}
      <Form.Item>
        <div className={styles.buttonWrapper}>
          <Space>
            <Button size={'middle'} onClick={navigateToDataset}>
              {t('cancel')}
            </Button>
            <Button
              type="primary"
              size={'middle'}
              loading={submitLoading}
              onClick={submitKnowledgeConfiguration}
            >
              {t('save')}
            </Button>
          </Space>
        </div>
      </Form.Item>
    </Form>
  );
};
