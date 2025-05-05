import api from '@/utils/api';
import registerServer from '@/utils/register-server';
import request from '@/utils/request';

const {
  getCanvas,
  getCanvasSSE,
  setCanvas,
  getListVersion,
  getVersion,
  listCanvas,
  resetCanvas,
  removeCanvas,
  runCanvas,
  listTemplates,
  testDbConnect,
  getInputElements,
  debug,
  listCanvasTeam,
  settingCanvas,
  completion,
  cloneCanvas, // 添加cloneCanvas API
} = api;

const methods = {
  getCanvas: {
    url: getCanvas,
    method: 'get',
  },
  getCanvasSSE: {
    url: getCanvasSSE,
    method: 'get',
  },
  setCanvas: {
    url: setCanvas,
    method: 'post',
  },
  getListVersion: {
    url: getListVersion,
    method: 'get',
  },
  getVersion: {
    url: getVersion,
    method: 'get',
  },
  listCanvas: {
    url: listCanvas,
    method: 'get',
  },
  // 添加专门用于获取对话列表的函数
  listConversations: {
    url: listCanvas, // 复用同一个接口
    method: 'get',
  },
  resetCanvas: {
    url: resetCanvas,
    method: 'post',
  },
  removeCanvas: {
    url: removeCanvas,
    method: 'post',
  },
  runCanvas: {
    url: runCanvas,
    method: 'post',
  },
  listTemplates: {
    url: listTemplates,
    method: 'get',
  },
  testDbConnect: {
    url: testDbConnect,
    method: 'post',
  },
  getInputElements: {
    url: getInputElements,
    method: 'get',
  },
  debugSingle: {
    url: debug,
    method: 'post',
  },
  listCanvasTeam: {
    url: listCanvasTeam,
    method: 'get',
  },
  settingCanvas: {
    url: settingCanvas,
    method: 'post',
  },
  // 添加completion方法
  completion: {
    url: completion || '/v1/canvas/completion',
    method: 'post',
  },
  // 添加cloneCanvas方法
  cloneCanvas: {
    url: cloneCanvas,
    method: 'post',
  },
} as const;

const flowService = registerServer<keyof typeof methods>(methods, request);

export default flowService;
