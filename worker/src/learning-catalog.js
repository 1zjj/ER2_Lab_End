// Verified against the ER2 knowledge-base directory on 2026-09-08.
const wiki = token => 'https://lcnywl4yrecr.feishu.cn/wiki/' + token;
export const LEARNING_VERSION = 'learning-text-v1';
export const LEARNING_CATALOG = Object.freeze({
  version: 1, url: wiki('AMikwNK58iWRCbkvoBJcQ7Q3nmc'),
  tracks: [
    { id: 'A', title: 'Track A｜感知与语义导航', available: true,
      url: wiki('QfYSw04GqiUoQTkt6Wtcdszvnxc'), lessons: [
        ['01', '仿真与系统结构', 'VLFTwiA5ti9il0kwfZjcyjSQnmc'],
        ['02', 'ROS 数据流', 'ECAKwt446iyaAZk3LLFc6TmRnhb'],
        ['03', '机器人本体与 TF', 'PWlywVEiGirZHCkNS1qcocA2nng'],
        ['04', '传感器原始数据', 'HlZWwHfFyidCXRkP4DpcLoeen4e'],
        ['05', 'FAST-LIO2', 'C6ZkwIGHZiqFKWk37xMcutdSn0c'],
        ['06', '地图与 Costmap', 'I42DwXJq6io82YkmEJacaaIEnNb'],
        ['07', '全局规划', 'G598wdF7jiYNyekIUDUcuGNKnEg'],
        ['08', '局部规划与控制', 'ZCIUwMWsmiktoOk0yfccJVQznee'],
        ['09', '语义导航', 'GHJewQtTDidQsCkXqdmcj0ZCnFd'],
        ['10', '综合实验与报告', 'LyAVwcd6ei8l5QkTSafcWHGznEf']
      ].map(([id, title, token]) => ({ id, title, url: wiki(token) })) },
    { id: 'B', title: 'Track B｜操作与装配', available: false, lessons: [] },
    { id: 'C', title: 'Track C｜规划与多智能体', available: false, lessons: [] }
  ]
});
