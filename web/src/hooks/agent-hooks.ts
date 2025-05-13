import i18n from '@/locales/config';
import flowService from '@/services/flow-service';
import userService, { listTenantUser } from '@/services/user-service';
import request from '@/utils/request';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { message } from 'antd';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSetModalState } from './common-hooks';
import { EmptyDsl, useFetchFlowTemplates } from './flow-hooks';

// 获取当前用户ID和团队信息的钩子
export const useCurrentUser = () => {
  const { data, isFetching: loading } = useQuery({
    queryKey: ['currentUser'],
    queryFn: async () => {
      try {
        // 使用user-service调用
        const { data } = await userService.user_info();
        if (data?.code === 0 && data?.data) {
          console.log('获取到的用户信息:', data.data);
          return data.data;
        }
        return { id: '', tenant_id: '' };
      } catch (error) {
        console.error('获取用户信息失败:', error);
        return { id: '', tenant_id: '' };
      }
    },
  });

  return {
    data: data || { id: '', tenant_id: '' },
    loading,
  };
};

// 获取团队成员列表的钩子
export const useTeamMembers = (tenantId: string) => {
  const { data: currentUser } = useCurrentUser();
  const actualTenantId = tenantId || currentUser?.tenant_id;

  const { data, isFetching: loading } = useQuery({
    queryKey: ['teamMembers', actualTenantId],
    enabled: !!actualTenantId,
    queryFn: async () => {
      try {
        // 确保有有效的租户ID
        if (!actualTenantId) {
          console.error('租户ID为空，无法获取团队成员');
          return [];
        }

        console.log(`使用租户ID: ${actualTenantId} 查询团队成员列表`);

        // 使用user-service中的listTenantUser方法查询团队成员
        const { data } = await listTenantUser(actualTenantId);

        if (data?.code === 0 && data?.data) {
          // 正确提取所有用户ID，从ITenantUser接口中我们知道user_id是唯一ID字段
          const memberIds = data.data
            .filter((user: any) => user.user_id) // 确保user_id存在
            .map((user: any) => user.user_id); // 只提取user_id字段

          console.log('获取到的团队成员列表:', data.data);
          console.log('提取的团队成员IDs:', memberIds);

          return memberIds;
        } else {
          console.error('获取团队成员响应异常:', data);
        }

        return [];
      } catch (error) {
        console.error('获取团队成员失败:', error);
        return [];
      }
    },
  });

  return {
    teamMembers: data || [],
    loading,
  };
};

// 获取Agent列表
export const useFetchAgentList = () => {
  const {
    data,
    error,
    isFetching: loading,
    refetch,
  } = useQuery({
    queryKey: ['fetchAgentList'],
    queryFn: async () => {
      try {
        const { data } = await flowService.listCanvas({
          page: 1,
          page_size: 100,
          keywords: '',
        });

        console.log('获取Agent列表API响应数据:', data);

        // 确保返回正确的数据
        if (data?.code === 0 && data?.data) {
          // 如果响应中有kbs字段，使用它
          let items = data.data.kbs || data.data.items || data.data || [];

          console.log('原始列表项目总数:', items.length);

          // 显示前5个项目的详情，用于分析
          console.log('前5个项目的关键字段:');
          items.slice(0, 5).forEach((item, index) => {
            console.log(`项目 ${index}:`, {
              id: item.id,
              title: item.title,
              is_virtual: item.is_virtual,
              has_dsl: !!item.dsl,
            });
          });

          // 根据is_virtual字段过滤 - 只保留is_virtual=true的项目（助理）
          const assistantItems = items.filter((item: any) => {
            // 使用is_virtual字段判断
            if (
              item.is_virtual === true ||
              item.is_virtual === 'true' ||
              item.is_virtual === 1
            ) {
              console.log(
                `项目 ${item.title} 是助理 (is_virtual=${item.is_virtual})`,
              );
              return true;
            } else {
              console.log(
                `项目 ${item.title} 是对话 (is_virtual=${item.is_virtual})`,
              );
              return false;
            }
          });

          console.log('过滤后的助理列表数量:', assistantItems.length);
          console.log(
            '过滤后的助理列表:',
            assistantItems.map((item) => item.title),
          );

          return assistantItems;
        }

        return [];
      } catch (error) {
        console.error('获取Agent列表失败:', error);
        return [];
      }
    },
  });

  return {
    data: data || [],
    loading,
    error,
    refetch,
  };
};

// 获取对话列表
export const useFetchConversationList = (catalog?: string) => {
  const {
    data,
    error,
    isFetching: loading,
    refetch,
  } = useQuery({
    queryKey: ['fetchConversationList', catalog],
    queryFn: async () => {
      try {
        // 构建查询参数
        const params: any = {
          page: 1,
          page_size: 100,
          keywords: '',
          is_virtual: false, // 明确指定只查询is_virtual=false的对话，不包含助理
        };

        // 如果有catalog参数，添加到查询条件中
        if (catalog) {
          params.catalog = catalog;
          console.log(`使用catalog参数过滤对话列表: ${catalog}`);
        }

        // 尝试使用自定义接口获取对话列表
        try {
          const { data } = await request.get('/v1/canvas/conversation/list', {
            params,
          });

          console.log('尝试使用专用conversation接口获取对话列表:', data);

          if (data?.code === 0 && data?.data) {
            return data.data;
          }
        } catch (error) {
          console.warn(
            '专用conversation接口不可用，将使用通用canvas/list接口:',
            error,
          );
        }

        // 如果专用接口失败，使用通用接口并筛选
        const { data } = await flowService.listCanvas(params);

        console.log('获取对话列表API响应数据:', data);

        // 确保返回正确的数据
        if (data?.code === 0 && data?.data) {
          // 如果响应中有kbs字段，使用它
          let items = data.data.kbs || data.data.items || data.data || [];

          console.log('原始对话项目总数:', items.length);

          // 根据is_virtual字段过滤 - 只保留is_virtual=false的项目（对话）
          const conversationItems = items.filter((item: any) => {
            // 使用is_virtual字段判断
            if (
              item.is_virtual === false ||
              item.is_virtual === 'false' ||
              item.is_virtual === 0
            ) {
              console.log(
                `项目 ${item.title} 是对话 (is_virtual=${item.is_virtual})`,
              );
              return true;
            } else {
              console.log(
                `项目 ${item.title} 是助理 (is_virtual=${item.is_virtual})`,
              );
              return false;
            }
          });

          console.log('过滤后的对话列表数量:', conversationItems.length);
          if (conversationItems.length > 0) {
            console.log(
              '过滤后的对话列表:',
              conversationItems.map((item) => item.title),
            );
          }

          return conversationItems;
        }

        return [];
      } catch (error) {
        console.error('获取对话列表失败:', error);
        return [];
      }
    },
  });

  return {
    data: data || [],
    loading,
    error,
    refetch,
  };
};

// 模板相关hook
export const useTemplateSelection = () => {
  const {
    visible: templateModalVisible,
    hideModal: hideTemplateModal,
    showModal: showTemplateModal,
  } = useSetModalState();

  const {
    visible: agentSettingVisible,
    hideModal: hideAgentSettingModal,
    showModal: showAgentSettingModal,
  } = useSetModalState();

  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    null,
  );

  const handleTemplateSelect = useCallback(
    (templateId: string) => {
      setSelectedTemplateId(templateId);
      // 先隐藏模板选择对话框
      hideTemplateModal();
      // 然后显示Agent设置对话框
      showAgentSettingModal();
    },
    [hideTemplateModal, showAgentSettingModal],
  );

  return {
    templateModalVisible,
    hideTemplateModal,
    showTemplateModal,
    agentSettingVisible,
    hideAgentSettingModal,
    showAgentSettingModal,
    selectedTemplateId,
    handleTemplateSelect,
  };
};

// 创建Agent
export const useCreateAgent = () => {
  const queryClient = useQueryClient();
  const templateSelection = useTemplateSelection();
  const { data: templateList } = useFetchFlowTemplates();
  const { data: currentUser } = useCurrentUser();

  // 辅助函数：查找具有特定属性的节点
  const findNodesWithProperty = (dsl: any, propertyName: string): any[] => {
    const result: any[] = [];

    // 检查直接的nodes数组
    if (dsl && dsl.nodes && Array.isArray(dsl.nodes)) {
      const directNodes = dsl.nodes.filter(
        (node: any) =>
          node.data && node.data.form && propertyName in node.data.form,
      );
      result.push(...directNodes);
    }

    // 检查graph结构中的nodes
    if (dsl && dsl.graph && dsl.graph.nodes && Array.isArray(dsl.graph.nodes)) {
      const graphNodes = dsl.graph.nodes.filter(
        (node: any) =>
          node.data && node.data.form && propertyName in node.data.form,
      );
      result.push(...graphNodes);
    }

    // 检查components结构
    if (dsl && dsl.components) {
      Object.keys(dsl.components).forEach((key) => {
        const component = dsl.components[key];
        if (
          component &&
          component.obj &&
          component.obj.params &&
          propertyName in component.obj.params
        ) {
          // 为组件创建一个类似节点的结构用于返回
          result.push({
            id: key,
            data: {
              form: component.obj.params,
            },
            type: 'component',
          });
        }
      });
    }

    return result;
  };

  // 辅助函数：处理DSL模板，替换LLM模型和知识库参数
  const processDslTemplate = (
    dsl: any,
    modelId?: string,
    knowledgeIds?: string[],
  ) => {
    if (!dsl) return EmptyDsl;

    try {
      // 创建DSL的深拷贝，避免修改原始模板
      const processedDsl = JSON.parse(JSON.stringify(dsl));

      // 检查DSL结构是否包含nodes数组
      if (processedDsl.nodes && Array.isArray(processedDsl.nodes)) {
        processedDsl.nodes.forEach((node: any) => {
          if (node.data && node.data.form) {
            // 替换LLM模型ID
            if (modelId && 'llm_id' in node.data.form) {
              console.log(
                `替换节点 ${node.id} 的模型ID: ${node.data.form.llm_id} -> ${modelId}`,
              );
              node.data.form.llm_id = modelId;

              // 处理模型特定参数 - 如果模型ID中包含特定标识，可以添加特定参数
              if (
                modelId.includes('deepseek') &&
                !('parameter' in node.data.form)
              ) {
                node.data.form.parameter = 'Precise';
              }
            }

            // 替换知识库IDs
            if (
              knowledgeIds &&
              knowledgeIds.length > 0 &&
              'kb_ids' in node.data.form
            ) {
              console.log(
                `替换节点 ${node.id} 的知识库IDs: ${JSON.stringify(node.data.form.kb_ids)} -> ${JSON.stringify(knowledgeIds)}`,
              );
              node.data.form.kb_ids = [...knowledgeIds];
            }
          }
        });
      }
      // 检查是否是graph格式的DSL
      else if (
        processedDsl.graph &&
        processedDsl.graph.nodes &&
        Array.isArray(processedDsl.graph.nodes)
      ) {
        processedDsl.graph.nodes.forEach((node: any) => {
          if (node.data && node.data.form) {
            // 替换LLM模型ID
            if (modelId && 'llm_id' in node.data.form) {
              console.log(
                `替换graph节点 ${node.id} 的模型ID: ${node.data.form.llm_id} -> ${modelId}`,
              );
              node.data.form.llm_id = modelId;

              // 处理模型特定参数
              if (
                modelId.includes('deepseek') &&
                !('parameter' in node.data.form)
              ) {
                node.data.form.parameter = 'Precise';
              }
            }

            // 替换知识库IDs
            if (
              knowledgeIds &&
              knowledgeIds.length > 0 &&
              'kb_ids' in node.data.form
            ) {
              console.log(
                `替换graph节点 ${node.id} 的知识库IDs: ${JSON.stringify(node.data.form.kb_ids)} -> ${JSON.stringify(knowledgeIds)}`,
              );
              node.data.form.kb_ids = [...knowledgeIds];
            }
          }
        });
      }

      // 检查是否有components对象需要处理
      if (processedDsl.components) {
        Object.keys(processedDsl.components).forEach((key) => {
          const component = processedDsl.components[key];
          if (component && component.obj && component.obj.params) {
            // 替换LLM模型ID
            if (modelId && 'llm_id' in component.obj.params) {
              console.log(
                `替换组件 ${key} 的模型ID: ${component.obj.params.llm_id} -> ${modelId}`,
              );
              component.obj.params.llm_id = modelId;

              // 处理模型特定参数
              if (
                modelId.includes('deepseek') &&
                !('parameter' in component.obj.params)
              ) {
                component.obj.params.parameter = 'Precise';
              }
            }

            // 替换知识库IDs
            if (
              knowledgeIds &&
              knowledgeIds.length > 0 &&
              'kb_ids' in component.obj.params
            ) {
              console.log(
                `替换组件 ${key} 的知识库IDs: ${JSON.stringify(component.obj.params.kb_ids)} -> ${JSON.stringify(knowledgeIds)}`,
              );
              component.obj.params.kb_ids = [...knowledgeIds];
            }
          }
        });
      }

      return processedDsl;
    } catch (error) {
      console.error('处理DSL模板出错:', error);
      return dsl; // 如果处理出错，返回原始模板
    }
  };

  const {
    data,
    isPending: loading,
    mutateAsync,
  } = useMutation({
    mutationKey: ['createAgent'],
    mutationFn: async (params: {
      title: string;
      description?: string;
      knowledge_ids?: string[];
      template_id?: string;
      is_private?: boolean;
      model_id?: string;
    }) => {
      // 查找选中的模板
      const templateItem = templateList?.find(
        (x) => x.id === params.template_id,
      );

      // 记录模板处理前的参数
      console.log('选择的模板:', templateItem?.title);
      console.log('选择的模型ID:', params.model_id);
      console.log('选择的知识库IDs:', params.knowledge_ids);

      if (templateItem?.dsl) {
        // 检查原始模板中的模型和知识库
        const llmNodes = findNodesWithProperty(templateItem.dsl, 'llm_id');
        const kbNodes = findNodesWithProperty(templateItem.dsl, 'kb_ids');

        console.log(
          '原始模板中的模型节点:',
          llmNodes.map((node) => ({
            id: node.id,
            llm_id: node.data.form.llm_id,
          })),
        );

        console.log(
          '原始模板中的知识库节点:',
          kbNodes.map((node) => ({
            id: node.id,
            kb_ids: node.data.form.kb_ids,
          })),
        );
      }

      // 处理模板DSL，替换LLM模型和知识库参数
      const processedDsl = processDslTemplate(
        templateItem?.dsl || EmptyDsl,
        params.model_id,
        params.knowledge_ids,
      );

      // 记录处理后的结果
      if (processedDsl !== EmptyDsl) {
        const llmNodes = findNodesWithProperty(processedDsl, 'llm_id');
        const kbNodes = findNodesWithProperty(processedDsl, 'kb_ids');

        console.log(
          '处理后的模型节点:',
          llmNodes.map((node) => ({
            id: node.id,
            llm_id: node.data.form.llm_id,
          })),
        );

        console.log(
          '处理后的知识库节点:',
          kbNodes.map((node) => ({
            id: node.id,
            kb_ids: node.data.form.kb_ids,
          })),
        );
      }

      // 生成一个随机的catalog值
      const generateCatalog = () => {
        const chars = '123456789abcdefghijklmnopqrstuvwxyz';
        let result = '';
        for (let i = 0; i < 16; i++) {
          result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
      };

      const flowParams: any = {
        title: params.title,
        description: params.description,
        dsl: processedDsl,
        avatar: templateItem?.avatar || '/logo.svg',
        is_private: params.is_private !== undefined ? params.is_private : true, // 默认为私有
        catalog: generateCatalog(), // 生成一个随机的catalog值
        is_virtual: 1, // 标记为助理而非对话
      };

      // 记录创建时使用的参数，便于后续维护
      if (params.knowledge_ids && params.knowledge_ids.length > 0) {
        flowParams.knowledge_ids = params.knowledge_ids;
      }

      // 记录选择的模型ID，用于后续提供相同模型的建议
      if (params.model_id) {
        flowParams.llm_id = params.model_id;
      }

      const { data = {} } = await flowService.setCanvas(flowParams);

      if (data.code === 0 && data.data?.id) {
        message.success(i18n.t('message.created'));

        // 如果设置为团队可见，则需要额外调用权限设置API更新权限
        if (params.is_private === false) {
          try {
            // 无论如何都会至少添加当前用户的权限
            if (!currentUser?.id) {
              console.error('缺少当前用户ID，无法设置权限');
              message.warning('用户ID未知，无法设置权限');
              return data;
            }

            // 如果没有租户ID，至少设置当前用户的权限
            if (!currentUser?.tenant_id) {
              console.warn('缺少租户ID，仅设置当前用户权限');
              await setCanvasPermissions(data.data.id, [currentUser.id]);
              return data;
            }

            console.log(`当前用户ID: ${currentUser.id}`);
            console.log(`当前用户的tenant_id: ${currentUser.tenant_id}`);

            // 发送请求获取团队成员列表
            console.log(
              `正在请求团队成员列表: /v1/tenant/${currentUser.tenant_id}/user/list`,
            );
            try {
              const teamResponse = await listTenantUser(currentUser.tenant_id);

              if (teamResponse?.data?.code === 0 && teamResponse.data.data) {
                console.log('成功获取团队成员列表:', teamResponse.data.data);

                // 从团队成员列表中提取user_id
                const teamMemberIds = teamResponse.data.data
                  .filter((user: any) => user.user_id) // 确保user_id存在
                  .map((user: any) => user.user_id); // 只提取user_id字段

                console.log('提取的团队成员IDs:', teamMemberIds);

                // 设置权限 - 包含团队成员和当前用户
                await setCanvasPermissions(data.data.id, teamMemberIds);
              } else {
                console.error('获取团队成员列表失败:', teamResponse);
                message.warning('无法获取团队成员，仅设置当前用户权限');

                // 仅设置当前用户的权限
                await setCanvasPermissions(data.data.id, [currentUser.id]);
              }
            } catch (teamError) {
              console.error('获取团队成员请求失败:', teamError);
              message.warning('团队成员查询失败，仅设置当前用户权限');

              // 仅设置当前用户的权限
              await setCanvasPermissions(data.data.id, [currentUser.id]);
            }
          } catch (error) {
            console.error('更新Canvas权限失败:', error);
            message.error('权限设置失败，请稍后在设置中手动更新');
          }
        }

        // 更新Agent列表缓存
        queryClient.invalidateQueries({ queryKey: ['fetchAgentList'] });
      }

      return data;
    },
  });

  // 辅助函数：设置画布权限
  const setCanvasPermissions = async (canvasId: string, userIds: string[]) => {
    try {
      // 先尝试直接获取最新的当前用户信息
      console.log('开始设置权限，当前用户对象:', currentUser);

      // 确保获取到最新的用户tenant_info
      let tenantId = currentUser?.tenant_id;
      try {
        console.log('尝试获取最新的租户信息...');
        const userTenantResponse = await request.get('/v1/user/tenant_info');
        if (
          userTenantResponse?.data?.code === 0 &&
          userTenantResponse.data.data
        ) {
          console.log('成功获取最新租户信息:', userTenantResponse.data.data);
          tenantId = userTenantResponse.data.data.tenant_id;
        } else {
          console.warn('无法获取最新租户信息，使用现有租户ID:', tenantId);
        }
      } catch (error) {
        console.error('获取租户信息失败:', error);
      }

      console.log('使用的租户ID:', tenantId);

      // 初始化用户ID列表
      let finalUserIds = [...userIds];

      // 如果有有效的租户ID，先获取最新的团队成员列表
      if (tenantId) {
        try {
          console.log(
            `请求最新的团队成员列表: /v1/tenant/${tenantId}/user/list`,
          );
          const teamResponse = await listTenantUser(tenantId);

          if (teamResponse?.data?.code === 0 && teamResponse.data.data) {
            console.log('成功获取团队成员列表:', teamResponse.data.data);

            // 从团队成员列表中提取user_id
            const teamMemberIds = teamResponse.data.data
              .filter((user: any) => user.user_id) // 确保user_id存在
              .map((user: any) => user.user_id); // 只提取user_id字段

            console.log('最新的团队成员IDs:', teamMemberIds);

            // 使用最新获取的团队成员ID列表
            finalUserIds = [...teamMemberIds];
          } else {
            console.error('获取团队成员列表失败:', teamResponse);
            message.warning('无法获取最新团队成员，使用原有数据');
          }
        } catch (teamError) {
          console.error('获取团队成员请求失败:', teamError);
          message.warning('团队成员查询失败，使用原有数据');
        }
      } else {
        console.warn('没有有效的租户ID，无法获取团队成员');
      }

      // 获取最新的当前用户ID
      let currentUserId = currentUser?.id;
      try {
        const userInfoResponse = await request.get('/v1/user/info');
        if (userInfoResponse?.data?.code === 0 && userInfoResponse.data.data) {
          currentUserId = userInfoResponse.data.data.id;
          console.log('获取到最新的当前用户ID:', currentUserId);
        }
      } catch (error) {
        console.error('获取用户信息失败:', error);
      }

      // 如果当前用户ID存在且不在列表中，添加它
      if (currentUserId && !finalUserIds.includes(currentUserId)) {
        finalUserIds.push(currentUserId);
      }

      // 如果列表为空但有当前用户ID，至少包含当前用户
      if (finalUserIds.length === 0 && currentUserId) {
        finalUserIds = [currentUserId];
      }

      // 过滤无效ID
      finalUserIds = finalUserIds.filter((id) => id && id.trim() !== '');

      // 确保至少有一个用户ID
      if (finalUserIds.length === 0) {
        console.error('没有有效的用户ID用于设置权限');
        message.warning('无法设置权限，用户ID列表为空');
        return false;
      }

      // 构建请求体
      const requestPayload = {
        canvas_ids: [canvasId],
        user_ids: finalUserIds,
        permission: 'team', // 添加 permission 参数，指定为 "team"
      };

      console.log('设置权限使用的用户IDs:', finalUserIds);
      console.log('发送权限更新请求:', requestPayload);

      // 发送权限设置请求
      const result = await request.post('/v1/canvas/update_permissions', {
        data: requestPayload,
      });

      console.log('权限设置响应:', result);

      if (result.data?.code !== 0) {
        console.error('权限设置返回错误:', result.data);
        message.warning('权限设置可能不正确，请稍后在设置中手动更新');
        return false;
      }

      message.success('权限设置成功');

      // 权限设置成功后，刷新代理列表
      try {
        console.log('权限设置成功，开始刷新代理列表...');
        // 调用API重新获取代理列表
        const listResponse = await flowService.listCanvas({
          page: 1,
          page_size: 100,
          keywords: '',
        });

        console.log('代理列表刷新结果:', listResponse.data);

        // 使用React Query的客户端手动更新缓存
        queryClient.invalidateQueries({ queryKey: ['fetchAgentList'] });

        message.success('代理列表已更新');
      } catch (refreshError) {
        console.error('刷新代理列表失败:', refreshError);
        // 这里不需要提示用户，因为列表刷新失败不影响主要功能
      }

      return true;
    } catch (error) {
      console.error('设置权限请求失败:', error);
      message.error('设置权限请求失败');
      return false;
    }
  };

  const onAgentOk = useCallback(
    async (
      name: string,
      description?: string,
      knowledgeIds?: string[],
      isPrivate?: boolean,
      modelId?: string,
    ) => {
      const ret = await mutateAsync({
        title: name,
        description,
        knowledge_ids: knowledgeIds,
        template_id: templateSelection.selectedTemplateId || 'empty',
        is_private: isPrivate,
        model_id: modelId,
      });

      if (ret?.code === 0) {
        templateSelection.hideAgentSettingModal();
      }

      return ret;
    },
    [mutateAsync, templateSelection],
  );

  return {
    ...templateSelection,
    loading,
    onAgentOk,
  };
};

// 删除Agent
export const useDeleteAgent = () => {
  const queryClient = useQueryClient();

  const { isPending: loading, mutateAsync } = useMutation({
    mutationKey: ['deleteAgent'],
    mutationFn: async (agentId: string) => {
      const { data } = await flowService.removeCanvas({ canvasIds: [agentId] });

      if (data.code === 0) {
        message.success(i18n.t('message.deleted'));
        // 更新Agent列表缓存
        queryClient.invalidateQueries({ queryKey: ['fetchAgentList'] });
      }

      return data;
    },
  });

  const deleteAgent = useCallback(
    async (agentId: string) => {
      return await mutateAsync(agentId);
    },
    [mutateAsync],
  );

  return {
    loading,
    deleteAgent,
  };
};

// 创建新对话
export const useCreateConversation = () => {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  const { isPending: loading, mutateAsync } = useMutation({
    mutationKey: ['createConversation'],
    mutationFn: async ({
      agentId,
      title,
      catalog,
    }: {
      agentId: string;
      title?: string;
      catalog?: string;
    }) => {
      try {
        console.log(
          `开始创建新对话，使用Agent: ${agentId}, catalog: ${catalog}`,
        );

        // 如果没有传入catalog参数，先获取源Agent的catalog
        let agentCatalog = catalog;
        if (!agentCatalog) {
          try {
            console.log('正在获取源Agent的catalog值...');
            const agentResponse = await request.get(
              `/v1/canvas/get/${agentId}`,
            );
            if (
              agentResponse.data?.code === 0 &&
              agentResponse.data.data?.catalog
            ) {
              agentCatalog = agentResponse.data.data.catalog;
              console.log(`成功获取源Agent的catalog: ${agentCatalog}`);
            }
          } catch (error) {
            console.error('获取源Agent信息失败:', error);
          }
        }

        // 使用克隆canvas API创建新对话
        const { data } = await flowService.cloneCanvas({
          canvas_id: agentId,
          new_title: title || `新对话 ${new Date().getTime()}`,
          is_virtual: false, // 明确指定为对话类型，不是虚拟助理
          preserve_catalog: true, // 保留源Agent的catalog值，确保新对话在相同分组
        });

        console.log('克隆API响应:', data);

        if (data.code === 0 && data.data) {
          console.log('成功创建新对话:', data.data);

          // 更新所有相关的对话列表缓存
          // 1. 更新无catalog筛选的列表
          queryClient.invalidateQueries({
            queryKey: ['fetchConversationList'],
          });

          // 2. 如果有catalog，更新特定catalog的列表
          if (agentCatalog) {
            console.log(`更新catalog=${agentCatalog}的对话列表`);
            queryClient.invalidateQueries({
              queryKey: ['fetchConversationList', agentCatalog],
            });
          }

          message.success(t('message.created'));
          return data.data; // 返回新创建的对话数据
        } else {
          console.error('创建对话API返回错误:', data);
          message.error(data?.message || t('message.createFailed'));
          return null;
        }
      } catch (error) {
        console.error('创建对话时发生错误:', error);
        message.error(t('message.createFailed'));
        return null;
      }
    },
  });

  const createConversation = useCallback(
    async (agentId: string, title?: string, catalog?: string) => {
      if (!agentId) {
        message.warning('请先选择一个Agent');
        return null;
      }

      return await mutateAsync({ agentId, title, catalog });
    },
    [mutateAsync],
  );

  return {
    loading,
    createConversation,
  };
};

// 删除对话
export const useDeleteConversation = () => {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  const { isPending: loading, mutateAsync } = useMutation({
    mutationKey: ['deleteConversation'],
    mutationFn: async (params: {
      conversationId: string;
      catalog?: string;
    }) => {
      try {
        console.log(`开始删除对话，ID: ${params.conversationId}`);

        // 使用removeCanvas API删除对话
        const { data } = await flowService.removeCanvas({
          canvasIds: [params.conversationId],
        });

        if (data.code === 0) {
          message.success(t('message.deleted'));

          // 刷新对话列表缓存，如果有catalog则使用它作为query key的一部分
          if (params.catalog) {
            queryClient.invalidateQueries({
              queryKey: ['fetchConversationList', params.catalog],
            });
          } else {
            queryClient.invalidateQueries({
              queryKey: ['fetchConversationList'],
            });
          }

          return true;
        }

        console.error('删除对话失败:', data);
        message.error(data?.message || t('message.deleteFailed'));
        return false;
      } catch (error) {
        console.error('删除对话过程中发生错误:', error);
        message.error(t('message.deleteFailed'));
        return false;
      }
    },
  });

  const deleteConversation = useCallback(
    async (conversationId: string, catalog?: string) => {
      if (!conversationId) {
        message.warning(t('message.selectConversationFirst'));
        return false;
      }

      return await mutateAsync({ conversationId, catalog });
    },
    [mutateAsync, t],
  );

  return {
    loading,
    deleteConversation,
  };
};

// 重命名对话
export const useRenameConversation = () => {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  const [conversationToRename, setConversationToRename] = useState<any>(null);
  const {
    visible: renameModalVisible,
    hideModal: hideRenameModal,
    showModal: showRenameModal,
  } = useSetModalState();

  const { isPending: loading, mutateAsync } = useMutation({
    mutationKey: ['renameConversation'],
    mutationFn: async (params: {
      conversationId: string;
      newTitle: string;
      catalog?: string;
    }) => {
      try {
        console.log(
          `开始重命名对话，ID: ${params.conversationId}, 新名称: ${params.newTitle}`,
        );

        // 首先获取当前对话的完整信息
        const response = await request.get(
          `/v1/canvas/get/${params.conversationId}`,
        );
        const conversationData = response.data;

        if (conversationData.code !== 0 || !conversationData.data) {
          console.error('获取对话信息失败:', conversationData);
          message.error('获取对话信息失败');
          return false;
        }

        // 准备更新对话数据
        const originalData = conversationData.data;

        // 生成带有时间戳的标题
        const timestamp = new Date().getTime();
        const uniqueTitle = `${params.newTitle}_${timestamp.toString().slice(-6)}`;

        // 创建一个新的对象，只包含后端支持的字段
        // 注意: 移除了 display_title 字段
        const updateData = {
          id: params.conversationId,
          title: uniqueTitle, // 只使用title字段
          description: originalData.description,
          dsl: originalData.dsl,
          is_virtual:
            originalData.is_virtual !== undefined
              ? originalData.is_virtual
              : false,
          catalog: originalData.catalog,
          avatar: originalData.avatar || '/logo.svg',
        };

        console.log('更新的对话数据:', updateData);

        // 使用setCanvas API更新对话信息
        const { data } = await flowService.setCanvas(updateData);

        if (data.code === 0) {
          message.success(t('message.updated'));

          // 刷新对话列表缓存
          if (params.catalog) {
            queryClient.invalidateQueries({
              queryKey: ['fetchConversationList', params.catalog],
            });
          } else {
            queryClient.invalidateQueries({
              queryKey: ['fetchConversationList'],
            });
          }

          return true;
        }

        console.error('重命名对话失败:', data);
        message.error(data?.message || t('message.updateFailed'));
        return false;
      } catch (error) {
        console.error('重命名对话过程中发生错误:', error);
        message.error(t('message.updateFailed'));
        return false;
      }
    },
  });

  const showRenameModalForConversation = useCallback(
    (conversation: any) => {
      setConversationToRename(conversation);
      showRenameModal();
    },
    [showRenameModal],
  );

  const renameConversation = useCallback(
    async (newTitle: string, catalog?: string) => {
      if (!conversationToRename || !conversationToRename.id) {
        message.warning(t('message.selectConversationFirst'));
        return false;
      }

      const result = await mutateAsync({
        conversationId: conversationToRename.id,
        newTitle,
        catalog,
      });

      if (result) {
        hideRenameModal();
      }

      return result;
    },
    [mutateAsync, conversationToRename, hideRenameModal, t],
  );

  return {
    loading,
    renameConversation,
    showRenameModalForConversation,
    renameModalVisible,
    hideRenameModal,
    initialTitle:
      conversationToRename?.title && conversationToRename.title.includes('_')
        ? conversationToRename.title.split('_')[0]
        : conversationToRename?.title || '',
  };
};

// 对话相关钩子可以在此添加
