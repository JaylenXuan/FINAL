# CREDITS

> 规则：任何第三方素材（贴图、模型、音频、字体、代码）进来就在这加一行，写清来源、许可、链接。
> 演示前对着这张表自查一遍，报告里直接引用。

## 代码依赖

| 名称 | 版本 | 许可 | 用途 | 链接 |
| --- | --- | --- | --- | --- |
| three.js | 0.169.0 | MIT | 3D 渲染 | https://threejs.org |
| Vite | 5.4.11 | MIT | 构建 / 开发服务器 | https://vite.dev |

已移除、**不再需要署名**：`three-player-controller`（MIT）、`three-mesh-bvh`（MIT）——v0.2.0 删除。

## 贴图

| 文件 | 来源 | 许可 | 处理方式 |
| --- | --- | --- | --- |
| 待补 | 自行拍摄（校园实拍） | 自有 | Photopea 透视校正，1024/2048，jpg q80 |

## 模型 / 动画

| 文件 | 来源 | 许可 | 说明 |
| --- | --- | --- | --- |
| `public/models/billboards/nailong.png` | 萌娘共享（[分类:奶龙](https://commons.moegirl.org.cn/Category:%E5%A5%B6%E9%BE%99)） | **CC BY-NC-SA 4.0**：署名、非商用、相同方式共享 | 奶龙立牌，白底已抠，512px 高 |
| `public/models/billboards/naiwa.png` | [Orliss/nailong](https://github.com/Orliss/nailong)（仓库 MIT，角色版权归原作） | 非商用、署名 | 奶蛙立牌，白底已抠，512px 高 |
| `public/models/characters/deepseek-reset.vrm` | B站 @hihihihi202（经 npm 包 `dsh-plugin-whale-mate@0.6.3`） | **署名、非商用、允许修改** | 鲸鱼娘同学；VRM 1.0，用 `@pixiv/three-vrm` 加载 |
| 待补：奶龙 / 奶蛙 | 网络公开 STL（3D 打印模型） | 粉丝二创，版权归原作，仅课程非商用 | 转 GLB 后作静态同学，需在报告注明 |
| 待补 | Mixamo / Kenney | 按下载页标注 | 人物与动画；加载后测包围盒缩放到 1.75m |

## 音频

| 文件 | 来源 | 许可 | 说明 |
| --- | --- | --- | --- |
| 合成音 | 本项目 WebAudio 代码 | — | 无素材，无署名要求 |
| 待补：室内环境声 | CC0 音库（freesound / Kenney） | CC0 | ogg 优先、mp3 兜底，总包 < 5MB |
| 待补：室外环境声 | 同上 | CC0 | 同上 |

## 字体

界面使用系统字体（Helvetica Neue / Arial / Microsoft YaHei），未嵌入任何字体文件，无署名要求。
