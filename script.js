'use strict';

(() => {
  /* ========================================================================
     定数・カラーパレット
     ======================================================================== */

  const CSV_PATH = './data.csv';

  // 大分類ごとの識別カラー（隣り合う領域の色差が大きくなる順序で配置）
  const CATEGORY_PALETTE = [
    { bg: '#eef4fc', fg: '#144d9e', dot: '#1d66cf' }, // 1. ブルー（腹部など）
    { bg: '#fcf3e6', fg: '#8c4b06', dot: '#c97110' }, // 2. アンバー（神経など）
    { bg: '#eaf6f3', fg: '#0d6659', dot: '#148f7d' }, // 3. ティール
    { bg: '#f5eefb', fg: '#682c91', dot: '#8e44bf' }, // 4. パープル
    { bg: '#fbeef2', fg: '#992448', dot: '#cc3f6b' }, // 5. ローズ
    { bg: '#edf6ee', fg: '#1d6629', dot: '#2f8f3f' }, // 6. グリーン
    { bg: '#ebf5fa', fg: '#0c5e7d', dot: '#1685b5' }, // 7. スカイ
    { bg: '#fbf0ea', fg: '#943a14', dot: '#cc5b2b' }, // 8. コーラル
    { bg: '#f0effc', fg: '#48309e', dot: '#664ec9' }, // 9. インディゴ
    { bg: '#eff3f7', fg: '#32485e', dot: '#516c8a' }, // 10. スレート
  ];

  /* ========================================================================
     状態管理
     ======================================================================== */

  const state = {
    allItems: [],
    categories: [],
    categoryColors: new Map(),
    selectedCategories: new Set(), // 空の場合は「すべて」
    excludeDrawn: false,
    drawnIds: new Set(),
    isSpinning: false,
    hasLoadError: false,
  };

  /* ========================================================================
     DOM参照
     ======================================================================== */

  const dom = {
    remainingBadge: document.getElementById('remaining-badge'),
    categoryChips: document.getElementById('category-chips'),
    excludeToggle: document.getElementById('exclude-toggle'),
    resetBtn: document.getElementById('reset-btn'),
    resetBtnLabel: document.getElementById('reset-btn-label'),
    drawOneBtn: document.getElementById('draw-one-btn'),
    drawFiveBtn: document.getElementById('draw-five-btn'),
    noticeBanner: document.getElementById('notice-banner'),
    noticeText: document.getElementById('notice-text'),
    noticeResetBtn: document.getElementById('notice-reset-btn'),
    emptyState: document.getElementById('empty-state'),
    shuffleStage: document.getElementById('shuffle-stage'),
    shuffleStatus: document.getElementById('shuffle-status'),
    shuffleBadge: document.getElementById('shuffle-badge'),
    shuffleMinor: document.getElementById('shuffle-minor'),
    shuffleTitle: document.getElementById('shuffle-title'),
    shuffleProgressBar: document.getElementById('shuffle-progress-bar'),
    resultsWrapper: document.getElementById('results-wrapper'),
    resultsHeading: document.getElementById('results-heading'),
    resultList: document.getElementById('result-list'),
  };

  /* ========================================================================
     RFC 4180準拠 CSVパーサー（セル内改行・カンマ・エスケープ対応）
     ======================================================================== */

  /**
   * RFC 4180準拠でCSVテキストを2次元配列にパースする
   * @param {string} rawText
   * @returns {string[][]}
   */
  function parseCSV(rawText) {
    // UTF-8 BOMを除去
    const text = rawText.charCodeAt(0) === 0xfeff ? rawText.slice(1) : rawText;

    const rows = [];
    let currentRow = [];
    let currentField = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const nextChar = text[i + 1];

      if (inQuotes) {
        if (char === '"') {
          if (nextChar === '"') {
            // エスケープされたダブルクォート ("")
            currentField += '"';
            i++;
          } else {
            // クォート終了
            inQuotes = false;
          }
        } else if (char === '\r') {
          // セル内改行を \n に正規化
          if (nextChar === '\n') {
            i++;
          }
          currentField += '\n';
        } else {
          currentField += char;
        }
      } else {
        if (char === '"' && currentField.trim().length === 0) {
          currentField = '';
          inQuotes = true;
        } else if (char === ',') {
          currentRow.push(currentField);
          currentField = '';
        } else if (char === '\r' || char === '\n') {
          if (char === '\r' && nextChar === '\n') {
            i++;
          }
          currentRow.push(currentField);
          rows.push(currentRow);
          currentRow = [];
          currentField = '';
        } else {
          currentField += char;
        }
      }
    }

    // 末尾に改行がない最終行を取り込む
    if (currentField.length > 0 || currentRow.length > 0) {
      currentRow.push(currentField);
      rows.push(currentRow);
    }

    // 完全な空行を除外
    return rows.filter((row) => row.some((cell) => cell.trim() !== ''));
  }

  /**
   * パース済みCSV行を項目オブジェクト配列に変換する（3列・4列両対応）
   * @param {string[][]} rows
   * @returns {Array<{id: number, major: string, minor: string, item: string, checklist: string}>}
   */
  function buildItemsFromRows(rows) {
    if (rows.length <= 1) {
      return [];
    }

    const items = [];
    // 1行目はヘッダーとしてスキップ
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const major = (row[0] ?? '').trim();
      const minor = (row[1] ?? '').trim();
      const item = (row[2] ?? '').trim();
      const checklist = (row[3] ?? '').trim();

      if (!major && !minor && !item) {
        continue;
      }

      items.push({
        id: i,
        major: major || 'その他',
        minor,
        item,
        checklist,
      });
    }

    return items;
  }

  /* ========================================================================
     カテゴリ色・表示用ヘルパー
     ======================================================================== */

  function getCategoryColor(index) {
    if (index < CATEGORY_PALETTE.length) {
      return CATEGORY_PALETTE[index];
    }
    const hue = Math.round((index * 137.508) % 360);
    return {
      bg: `hsl(${hue}, 65%, 95%)`,
      fg: `hsl(${hue}, 65%, 30%)`,
      dot: `hsl(${hue}, 60%, 46%)`,
    };
  }

  function applyCategoryStyle(element, major) {
    const color = state.categoryColors.get(major) || CATEGORY_PALETTE[0];
    element.style.setProperty('--cat-bg', color.bg);
    element.style.setProperty('--cat-fg', color.fg);
    element.style.setProperty('--cat-dot', color.dot);
  }

  /**
   * 項目が空欄の場合は小分類をタイトルとして扱う
   */
  function getDisplayParts(entry) {
    if (entry.item) {
      return {
        minorLabel: entry.minor,
        titleText: entry.item,
      };
    }
    return {
      minorLabel: '',
      titleText: entry.minor || entry.major,
    };
  }

  /* ========================================================================
     絞り込み・抽選ロジック
     ======================================================================== */

  function getFilteredItems() {
    if (state.selectedCategories.size === 0) {
      return state.allItems;
    }
    return state.allItems.filter((entry) => state.selectedCategories.has(entry.major));
  }

  function getAvailableItems() {
    const filtered = getFilteredItems();
    if (!state.excludeDrawn) {
      return filtered;
    }
    return filtered.filter((entry) => !state.drawnIds.has(entry.id));
  }

  function shuffleArray(list) {
    const arr = list.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /**
   * 小分類文字列（例: "(4) 視診", "1. 準備"）から先頭の番号を抽出する
   */
  function extractMinorOrder(minorText) {
    if (!minorText) return Number.POSITIVE_INFINITY;
    const match = minorText.match(/[（(]?\s*(\d+)\s*[）).．:：]?/);
    return match ? Number.parseInt(match[1], 10) : Number.POSITIVE_INFINITY;
  }

  /**
   * 複数件抽選時の表示順ソート
   * 1. 大分類の登場順
   * 2. 小分類のCATO番号順（番号がない場合はCSV上の登場順）
   * 3. CSVの行順（同一小分類内での表の上から順）
   */
  function compareItemsForDisplay(a, b) {
    if (a.major !== b.major) {
      const majorDiff =
        state.categories.indexOf(a.major) - state.categories.indexOf(b.major);
      if (majorDiff !== 0) return majorDiff;
    }

    const numA = extractMinorOrder(a.minor);
    const numB = extractMinorOrder(b.minor);
    if (numA !== numB) {
      return numA - numB;
    }

    return a.id - b.id;
  }

  /**
   * 抽選ロジック
   * - 1個引き: 対象プールからランダムに1件
   * - 5個引き: 可能な限り「小分類」が重複しないように最大5件抽出し、
   *            小分類のCATO番号順およびCSVの行順で並べて返却
   */
  function drawFromPool(pool, count) {
    if (pool.length === 0) {
      return [];
    }

    if (count === 1) {
      const randomIndex = Math.floor(Math.random() * pool.length);
      return [pool[randomIndex]];
    }

    if (pool.length <= count) {
      return pool.slice().sort(compareItemsForDisplay);
    }

    const groups = new Map();
    for (const entry of pool) {
      const groupKey = entry.minor
        ? `${entry.major}\0${entry.minor}`
        : `__single_${entry.id}`;
      if (!groups.has(groupKey)) {
        groups.set(groupKey, []);
      }
      groups.get(groupKey).push(entry);
    }

    const shuffledKeys = shuffleArray(Array.from(groups.keys()));
    const selectedKeys = shuffledKeys.slice(0, Math.min(count, shuffledKeys.length));

    const picked = [];
    const pickedIds = new Set();

    for (const key of selectedKeys) {
      const candidates = groups.get(key);
      const chosen = candidates[Math.floor(Math.random() * candidates.length)];
      picked.push(chosen);
      pickedIds.add(chosen.id);
    }

    if (picked.length < count) {
      const remaining = pool.filter((entry) => !pickedIds.has(entry.id));
      const shuffledRemaining = shuffleArray(remaining);
      const needed = count - picked.length;
      for (let i = 0; i < needed && i < shuffledRemaining.length; i++) {
        picked.push(shuffledRemaining[i]);
      }
    }

    // 大分類・小分類のCATO番号順およびCSVの上から順に並べる
    return picked.sort(compareItemsForDisplay);
  }

  /* ========================================================================
     UI描画・状態更新
     ======================================================================== */

  function renderCategoryChips() {
    dom.categoryChips.textContent = '';

    const isAllActive = state.selectedCategories.size === 0;
    const allCount = state.excludeDrawn
      ? state.allItems.filter((item) => !state.drawnIds.has(item.id)).length
      : state.allItems.length;

    const allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = `filter-item filter-item--all${isAllActive ? ' is-active' : ''}`;
    allBtn.setAttribute('aria-pressed', String(isAllActive));
    allBtn.disabled = state.isSpinning;

    const allLabel = document.createElement('span');
    allLabel.textContent = 'すべて';
    const allCountSpan = document.createElement('span');
    allCountSpan.className = 'item-count';
    allCountSpan.textContent = String(allCount);
    allBtn.append(allLabel, allCountSpan);

    allBtn.addEventListener('click', () => {
      if (state.isSpinning) return;
      state.selectedCategories.clear();
      updateUI();
    });
    dom.categoryChips.appendChild(allBtn);

    for (const category of state.categories) {
      const isSelected = state.selectedCategories.has(category);
      const categoryItems = state.allItems.filter((item) => item.major === category);
      const count = state.excludeDrawn
        ? categoryItems.filter((item) => !state.drawnIds.has(item.id)).length
        : categoryItems.length;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `filter-item${isSelected ? ' is-active' : ''}`;
      btn.setAttribute('aria-pressed', String(isSelected));
      btn.disabled = state.isSpinning;
      applyCategoryStyle(btn, category);

      const dot = document.createElement('span');
      dot.className = 'item-dot';
      dot.setAttribute('aria-hidden', 'true');

      const label = document.createElement('span');
      label.textContent = category;

      const countSpan = document.createElement('span');
      countSpan.className = 'item-count';
      countSpan.textContent = String(count);

      btn.append(dot, label, countSpan);

      btn.addEventListener('click', () => {
        if (state.isSpinning) return;
        if (state.selectedCategories.has(category)) {
          state.selectedCategories.delete(category);
        } else {
          state.selectedCategories.add(category);
          if (state.selectedCategories.size === state.categories.length) {
            state.selectedCategories.clear();
          }
        }
        updateUI();
      });

      dom.categoryChips.appendChild(btn);
    }
  }

  function showNotice(message, { isError = false, showReset = false, pulse = false } = {}) {
    dom.noticeText.textContent = message;
    dom.noticeBanner.classList.toggle('is-error', isError);
    dom.noticeResetBtn.hidden = !showReset;
    dom.noticeBanner.hidden = false;

    if (pulse) {
      dom.noticeBanner.classList.remove('is-pulse');
      void dom.noticeBanner.offsetWidth;
      dom.noticeBanner.classList.add('is-pulse');
    }
  }

  function hideNotice() {
    dom.noticeBanner.hidden = true;
    dom.noticeBanner.classList.remove('is-error', 'is-pulse');
  }

  function updateUI() {
    if (state.hasLoadError) {
      return;
    }

    const filtered = getFilteredItems();
    const available = getAvailableItems();
    const drawnTotal = state.drawnIds.size;

    // 残り対象件数の更新
    dom.remainingBadge.textContent = '';
    if (state.excludeDrawn) {
      dom.remainingBadge.appendChild(document.createTextNode(`残り ${available.length}件`));
      if (available.length < filtered.length) {
        const totalSpan = document.createElement('span');
        totalSpan.className = 'remaining-total';
        totalSpan.textContent = ` / ${filtered.length}件`;
        dom.remainingBadge.appendChild(totalSpan);
      }
    } else {
      dom.remainingBadge.textContent = `対象 ${filtered.length}件`;
    }
    dom.remainingBadge.classList.toggle('is-empty', available.length === 0);

    // 領域フィルター再描画
    renderCategoryChips();

    // トグル・リセットボタンの更新
    dom.excludeToggle.disabled = state.isSpinning;
    dom.resetBtn.disabled = state.isSpinning || drawnTotal === 0;
    dom.resetBtnLabel.textContent =
      drawnTotal > 0 ? `出題済みをリセット (${drawnTotal})` : '出題済みをリセット';

    // 抽選ボタンの活性制御
    const canDraw = !state.isSpinning && available.length > 0;
    dom.drawOneBtn.disabled = !canDraw;
    dom.drawFiveBtn.disabled = !canDraw;

    if (available.length > 0 && available.length < 5) {
      dom.drawFiveBtn.textContent = `残り${available.length}件をまとめて引く`;
    } else {
      dom.drawFiveBtn.textContent = '5個まとめて引く';
    }

    // 全件出切り時の通知制御
    if (filtered.length > 0 && available.length === 0 && state.excludeDrawn) {
      showNotice('選択中の領域はすべて出題済みです。', { showReset: true });
    } else {
      hideNotice();
    }
  }

  function createChevronSvg() {
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('checklist-chevron');

    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', 'm6 9 6 6 6-6');
    svg.appendChild(path);
    return svg;
  }

  function renderChecklistLines(container, checklistText) {
    const lines = checklistText.split('\n');
    for (const line of lines) {
      const p = document.createElement('p');
      p.className = 'cl-line';
      if (/^[□・]/.test(line)) {
        p.classList.add('cl-line--item');
      } else if (/^[（(]注[）)]/.test(line)) {
        p.classList.add('cl-line--note');
      }
      p.textContent = line;
      container.appendChild(p);
    }
  }

  function createResultItem(entry, index, totalCount) {
    const article = document.createElement('article');
    article.className = 'result-item';
    article.style.animationDelay = `${index * 45}ms`;
    applyCategoryStyle(article, entry.major);

    // メタ行（大分類・連番）
    const meta = document.createElement('div');
    meta.className = 'item-meta';

    const tag = document.createElement('span');
    tag.className = 'category-tag';
    tag.textContent = entry.major;
    applyCategoryStyle(tag, entry.major);
    meta.appendChild(tag);

    if (totalCount > 1) {
      const num = document.createElement('span');
      num.className = 'item-index';
      num.textContent = `${index + 1} / ${totalCount}`;
      meta.appendChild(num);
    }

    article.appendChild(meta);

    // 小分類・項目
    const { minorLabel, titleText } = getDisplayParts(entry);
    if (minorLabel) {
      const minorEl = document.createElement('p');
      minorEl.className = 'item-minor';
      minorEl.textContent = minorLabel;
      article.appendChild(minorEl);
    }

    const titleEl = document.createElement('h3');
    titleEl.className = 'item-title';
    titleEl.textContent = titleText;
    article.appendChild(titleEl);

    // 答え合わせ（チェックリスト開閉）
    const checklistArea = document.createElement('div');
    checklistArea.className = 'item-checklist-area';

    const hasChecklist = entry.checklist.length > 0;
    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'checklist-toggle-btn';

    if (hasChecklist) {
      const panelId = `checklist-panel-${entry.id}-${index}`;
      toggleBtn.setAttribute('aria-expanded', 'false');
      toggleBtn.setAttribute('aria-controls', panelId);

      const labelSpan = document.createElement('span');
      labelSpan.textContent = '答え合わせ（チェックリストを表示）';
      toggleBtn.append(labelSpan, createChevronSvg());

      const panel = document.createElement('div');
      panel.id = panelId;
      panel.className = 'checklist-panel';
      panel.setAttribute('aria-hidden', 'true');

      const panelInner = document.createElement('div');
      panelInner.className = 'checklist-panel-inner';

      const content = document.createElement('div');
      content.className = 'checklist-content';
      renderChecklistLines(content, entry.checklist);

      panelInner.appendChild(content);
      panel.appendChild(panelInner);

      toggleBtn.addEventListener('click', () => {
        const isOpen = panel.classList.toggle('is-open');
        toggleBtn.setAttribute('aria-expanded', String(isOpen));
        panel.setAttribute('aria-hidden', String(!isOpen));
        labelSpan.textContent = isOpen
          ? 'チェックリストを閉じる'
          : '答え合わせ（チェックリストを表示）';
      });

      checklistArea.append(toggleBtn, panel);
    } else {
      toggleBtn.disabled = true;
      toggleBtn.textContent = 'チェックリスト未登録';
      checklistArea.appendChild(toggleBtn);
    }

    article.appendChild(checklistArea);
    return article;
  }

  function renderResults(results, requestedCount) {
    dom.resultList.textContent = '';

    dom.resultsHeading.textContent =
      requestedCount > 1 ? `抽選結果（${results.length}件）` : '抽選結果';

    results.forEach((entry, idx) => {
      dom.resultList.appendChild(createResultItem(entry, idx, results.length));
    });

    dom.emptyState.hidden = true;
    dom.shuffleStage.hidden = true;
    dom.resultsWrapper.hidden = false;
  }

  /* ========================================================================
     シャッフル演出付きガチャ実行
     ======================================================================== */

  function updateShufflePreview(entry) {
    const { minorLabel, titleText } = getDisplayParts(entry);
    dom.shuffleBadge.textContent = entry.major;
    applyCategoryStyle(dom.shuffleBadge, entry.major);
    dom.shuffleMinor.textContent = minorLabel;
    dom.shuffleTitle.textContent = titleText;
  }

  function runGacha(requestedCount) {
    if (state.isSpinning || state.hasLoadError) {
      return;
    }

    const available = getAvailableItems();
    if (available.length === 0) {
      showNotice('選択中の領域はすべて出題済みです。', { showReset: true, pulse: true });
      return;
    }

    const results = drawFromPool(available, requestedCount);
    const previewPool = available.length > 1 ? available : getFilteredItems();

    state.isSpinning = true;
    updateUI();

    dom.emptyState.hidden = true;
    dom.resultsWrapper.hidden = true;
    dom.shuffleStage.hidden = false;
    dom.shuffleStatus.textContent = '抽選中...';
    dom.shuffleProgressBar.style.width = '0%';

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const tickDelays = prefersReducedMotion
      ? [120, 140]
      : [65, 65, 70, 75, 80, 85, 95, 105, 115, 130, 145, 160];

    let step = 0;
    let lastPreviewId = null;

    const runStep = () => {
      if (step >= tickDelays.length) {
        if (state.excludeDrawn) {
          for (const entry of results) {
            state.drawnIds.add(entry.id);
          }
        }
        state.isSpinning = false;
        renderResults(results, requestedCount);
        updateUI();
        return;
      }

      let candidate = previewPool[Math.floor(Math.random() * previewPool.length)];
      if (previewPool.length > 1 && candidate.id === lastPreviewId) {
        candidate = previewPool[(previewPool.indexOf(candidate) + 1) % previewPool.length];
      }
      lastPreviewId = candidate.id;
      updateShufflePreview(candidate);

      const progress = Math.round(((step + 1) / tickDelays.length) * 100);
      dom.shuffleProgressBar.style.width = `${progress}%`;

      const delay = tickDelays[step];
      step++;
      window.setTimeout(runStep, delay);
    };

    runStep();
  }

  /* ========================================================================
     イベント設定 & 初期化
     ======================================================================== */

  function resetDrawnItems() {
    if (state.isSpinning) return;
    state.drawnIds.clear();
    updateUI();
  }

  function bindEvents() {
    dom.drawOneBtn.addEventListener('click', () => runGacha(1));
    dom.drawFiveBtn.addEventListener('click', () => runGacha(5));

    dom.excludeToggle.addEventListener('change', (event) => {
      state.excludeDrawn = event.target.checked;
      updateUI();
    });

    dom.resetBtn.addEventListener('click', resetDrawnItems);
    dom.noticeResetBtn.addEventListener('click', resetDrawnItems);
  }

  async function init() {
    bindEvents();

    try {
      const response = await fetch(CSV_PATH, { cache: 'no-cache' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const csvText = await response.text();
      const rows = parseCSV(csvText);
      const items = buildItemsFromRows(rows);

      if (items.length === 0) {
        throw new Error('CSVに有効なデータ行がありません。');
      }

      state.allItems = items;

      const categorySet = new Set();
      for (const entry of items) {
        categorySet.add(entry.major);
      }
      state.categories = Array.from(categorySet);
      state.categories.forEach((cat, idx) => {
        state.categoryColors.set(cat, getCategoryColor(idx));
      });

      updateUI();
    } catch (error) {
      state.hasLoadError = true;
      dom.remainingBadge.textContent = '読込エラー';
      dom.remainingBadge.classList.add('is-empty');
      dom.drawOneBtn.disabled = true;
      dom.drawFiveBtn.disabled = true;
      dom.excludeToggle.disabled = true;
      dom.emptyState.hidden = true;

      showNotice(
        'data.csv を読み込めませんでした。HTTPサーバーまたは GitHub Pages 上で開いてください。',
        { isError: true }
      );
      console.error('CSV load error:', error);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
