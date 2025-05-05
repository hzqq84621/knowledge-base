/**
 * 对话重命名模态框组件
 * 用于重命名Agent对话
 */
import { useTranslate } from '@/hooks/common-hooks';
import { Form, Input, Modal } from 'antd';

/**
 * 重命名模态框属性接口
 */
interface IProps {
  visible: boolean;
  hideModal: () => void;
  onOk: (title: string) => void;
  initialTitle: string;
  loading: boolean;
}

/**
 * 表单字段类型
 */
type FieldType = {
  title: string;
};

/**
 * 对话重命名模态框组件
 */
const RenameConversationModal = ({
  visible,
  hideModal,
  onOk,
  initialTitle,
  loading,
}: IProps) => {
  const { t } = useTranslate('agent');
  const [form] = Form.useForm<FieldType>();

  // 处理表单提交
  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      onOk(values.title);
    } catch (error) {
      console.error('表单验证失败:', error);
    }
  };

  // 对话框打开时设置初始值
  const handleOpen = () => {
    form.setFieldsValue({ title: initialTitle });
  };

  return (
    <Modal
      title={t('renameConversation')}
      open={visible}
      onOk={handleOk}
      onCancel={hideModal}
      afterOpenChange={(visible) => visible && handleOpen()}
      confirmLoading={loading}
      maskClosable={false}
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        name="rename_conversation_form"
        initialValues={{ title: initialTitle }}
      >
        <Form.Item<FieldType>
          label={t('conversationTitle')}
          name="title"
          rules={[{ required: true, message: t('inputConversationTitle') }]}
        >
          <Input placeholder={t('inputConversationTitle')} autoFocus />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default RenameConversationModal;
