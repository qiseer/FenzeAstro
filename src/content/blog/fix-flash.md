---
title: "暗色模式闪烁解决方案"
description: "解决暗色刷新闪烁问题"
pubDate: 2026-03-22
updatedDate: 2026-03-22
author: "Qiseer"
tags: ["Fix", "Bug" , "log"]
image: "none"
subject: ""
---

如果使用暗色模式，会出现刷新闪烁的问题。

这是一个前端开发中常见的"闪烁"问题（Flash of Unstyled Content，简称FOUC），特别是在使用暗色主题时，页面在加载或跳转时会先显示白色背景，然后才切换到暗色主题，造成视觉上的闪烁。

闪烁发生在两个场景：
1. 初始加载：浏览器先渲染默认（通常是亮色）主题，然后 JavaScript 执行后才切换到暗色主题
2. View Transitions 跳转：使用 `<ClientRouter />` 时，页面切换过程中样式重新计算导致闪烁

**解决方案**


### 1
在 `<head>` 中放置内联脚本  
脚本必须在 `<head>` 中同步执行，阻塞渲染，确保在首次绘制前应用主题：
```astro
<!-- src/components/ThemeScript.astro -->
<script is:inline>
  (function() {
    const theme = localStorage.getItem('theme') || 'system';
    const isDark = theme === 'dark' || 
      (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    
    if (isDark) {
      document.documentElement.classList.add('dark');
    }
  })();
</script>
```
然后在布局文件中(例如Layout.astro)引入:
```astro
---
import ThemeScript from './ThemeScript.astro';
---
<html>
  <head>
    <ThemeScript />  <!-- 必须放在最前面！ -->
    <meta charset="utf-8" />
    <!-- 其他 head 内容 -->
  </head>
</html>
```

### 2
处理 View Transitions 跳转闪烁  
如果使用了 `<ClientRouter />`，需要在页面切换后重新应用主题：
```astro
<script is:inline>
  function applyTheme() {
    const theme = localStorage.getItem('theme') || 'system';
    const isDark = theme === 'dark' || 
      (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    
    document.documentElement.classList.toggle('dark', isDark);
  }
  
  // 初始应用
  applyTheme();
  
  // 监听 View Transition 的交换事件
  document.addEventListener('astro:after-swap', applyTheme);
</script>
```
astro:after-swap 事件在新页面 DOM 替换完成后、绘制前触发，可以阻止闪烁
### 3 （推荐）
社区有完整的解决方案，astro-theme-toggler ，它封装了上述所有逻辑

```bash
npm install @yarso/astro-theme-toggler
```
使用也很简单：
```astro
---
import { LoadTheme, ThemeToggler } from '@yarso/astro-theme-toggler';
---
<head>
  <LoadTheme />  <!-- 自动处理 FOUC -->
</head>
<body>
  <ThemeToggler class="theme-btn">
    <span>🌞</span>  <!-- 亮色图标 -->
    <span>🌙</span>  <!-- 暗色图标 -->
  </ThemeToggler>
</body>
```


### 原理

这个代码能解决闪烁问题，核心在于它在浏览器首次绘制（First Paint）之前就同步执行了主题设置。  
- 浏览器解析 HTML 是从上到下的  
- `<script> 在 <head> 中时，会阻塞后续 DOM 的渲染  `
- CSS 和页面内容还没绘制，主题就已经设置好了  

也就是说，增加了上面的代码后，此时顺序为：
1. 解析head
2. 执行inline脚本（设置theme为dark）
3. 解析css（dark）
4. 渲染页面

### 其他

**is:inline的作用**
| 特性                | 普通 `<script>`                | `<script is:inline>`          |
| ------------------- | ------------------------------ | ----------------------------- |
| 处理方式            | Astro 打包、压缩、可能延迟加载 | 原样输出到 HTML，**立即执行** |
| 执行时机            | 可能异步或延迟                 | **同步阻塞**                  |
| 能否访问 `document` | 不确定                         | 确定可以                      |

is:inline 确保代码不被 Vite/Astro 优化干扰，保持同步内联执行。

### 总结

上面代码解决闪烁的三要素：

| 要素                | 作用                       |
| ------------------- | -------------------------- |
| **位置在 `<head>`** | 在首次绘制前执行           |
| **`is:inline`**     | 避免被打包延迟，保持同步   |
| **IIFE 同步逻辑**   | 立即计算并应用主题，无等待 |
