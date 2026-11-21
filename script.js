'use strict';

(() => {
  /* ========================================================================
     定数・カラーパレット
     ======================================================================== */

  const CSV_PATH = './data.csv';

  // 大分類バッジ用カラーパレット（清潔感のある医療系トーン）
  const CATEGORY_PALETTE = [
    { bg: '#e8f1fe', fg: '#1552a8', border: '#c5dcfa', dot: '#2570db' }, // ブルー
    { bg: '#f0ecfe', fg: '#5332a8', border: '#d8cdfc', dot: '#7353d4' }, // インディゴ
    { bg: '#e5f6f3', fg: '#0d6b5e', border: '#bce6de', dot: '#149684' }, // ティール
    { bg: '#fef3e2', fg: '#9a5409', border: '#f8dbb0', dot: '#d98218' }, // アンバー
    { bg: '#fdebf0', fg: '#a1254c', border: '#f6cad7', dot: '#d64572' }, // ローズ
    { bg: '#e6f5fb', fg: '#0c6385', border: '#bde2f2', dot: '#188ec0' }, // スカイ
    { bg: '#eaf6ea', fg: '#1e6e2b', border: '#c3e6c6', dot: '#349944' }, // グリーン
    { bg: '#f6ecfa', fg: '#782b94', border: '#e3c7ee', dot: '#a34bc4' }, // パープル
    { bg: '#fceee6', fg: '#9e3e15', border: '#f5d0bc', dot: '#d96230' }, // コーラル
    { bg: '#edf2f7', fg: '#334a63', border: '#cdd9e5', dot: '#54708f' }, // スレート
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
    drawnCount: document.getElementById('drawn-count'),
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
    resultsMeta: document.getElementById('results-meta'),
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

      // 大分類・小分類・項目がすべて空の行は無視
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
    // パレット数を超えた大分類が追加されても自動で識別可能な色を生成
    const hue = Math.round((index * 137.508) % 360);
    return {
      bg: `hsl(${hue}, 70%, 95%)`,
      fg: `hsl(${hue}, 65%, 30%)`,
      border: `hsl(${hue}, 55%, 82%)`,
      dot: `hsl(${hue}, 65%, 48%)`,
    };
  }

  function applyCategoryStyle(element, major) {
    const color = state.categoryColors.get(major) || CATEGORY_PALETTE[0];
    element.style.setProperty('--cat-bg', color.bg);
    element.style.setProperty('--cat-fg', color.fg);
    element.style.setProperty('--cat-border', color.border);
    element.style.setProperty('--cat-dot', color.dot);
  }

  /**
   * 項目の表示用タイトルと小分類ラベルを返す
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
   * 抽選ロジック
   * - 1個引き: 対象プールからランダムに1件
   * - 5個引き: 可能な限り「小分類」が重複しないように最大5件抽出
   *   1) 小分類ごとにグループ化し、ランダムに最大5つの小分類を選んで各1件抽出
   *   2) 小分類が5種類未満なら、未選択の残り項目からランダムに補充
   *   3) 総数が5件未満なら残っている全件をシャッフルして返却
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
      return shuffleArray(pool);
    }

    // 小分類ごとにグループ化
    const groups = new Map();
    for (const entry of pool) {
      const groupKey = entry.minor || `__single_${entry.id}`;
      if (!groups.has(groupKey)) {
        groups.set(groupKey, []);
      }
      groups.get(groupKey).push(entry);
    }

    // ランダムに最大count個の小分類を選択し、各小分類から1件ずつ抽出
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

    // 5件に満たない場合は未選択の残り項目からランダムに補充
    if (picked.length < count) {
      const remaining = pool.filter((entry) => !pickedIds.has(entry.id));
      const shuffledRemaining = shuffleArray(remaining);
      const needed = count - picked.length;
      for (let i = 0; i < needed && i < shuffledRemaining.length; i++) {
        picked.push(shuffledRemaining[i]);
      }
    }

    return shuffleArray(picked);
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

    // 「すべて」チップ
    const allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = `filter-chip filter-chip--all${isAllActive ? ' is-active' : ''}`;
    allBtn.setAttribute('aria-pressed', String(isAllActive));
    allBtn.disabled = state.isSpinning;

    const allLabel = document.createElement('span');
    allLabel.textContent = 'すべて';
    const allCountSpan = document.createElement('span');
    allCountSpan.className = 'chip-count';
    allCountSpan.textContent = String(allCount);
    allBtn.append(allLabel, allCountSpan);

    allBtn.addEventListener('click', () => {
      if (state.isSpinning) return;
      state.selectedCategories.clear();
      updateUI();
    });
    dom.categoryChips.appendChild(allBtn);

    // 各大分類チップ
    for (const category of state.categories) {
      const isSelected = state.selectedCategories.has(category);
      const categoryItems = state.allItems.filter((item) => item.major === category);
      const count = state.excludeDrawn
        ? categoryItems.filter((item) => !state.drawnIds.has(item.id)).length
        : categoryItems.length;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `filter-chip${isSelected ? ' is-active' : ''}`;
      btn.setAttribute('aria-pressed', String(isSelected));
      btn.disabled = state.isSpinning;
      applyCategoryStyle(btn, category);

      const dot = document.createElement('span');
      dot.className = 'chip-dot';
      dot.setAttribute('aria-hidden', 'true');

      const label = document.createElement('span');
      label.textContent = category;

      const countSpan = document.createElement('span');
      countSpan.className = 'chip-count';
      countSpan.textContent = String(count);

      btn.append(dot, label, countSpan);

      btn.addEventListener('click', () => {
        if (state.isSpinning) return;
        if (state.selectedCategories.has(category)) {
          state.selectedCategories.delete(category);
        } else {
          state.selectedCategories.add(category);
          // 全大分類が個別に選ばれたら「すべて」と同等に正規化
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

    // 残り対象件数バッジの更新
    dom.remainingBadge.textContent = '';
    if (state.excludeDrawn) {
      const mainText = document.createTextNode(`残り ${available.length}件`);
      dom.remainingBadge.appendChild(mainText);
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

    // チップ再描画
    renderCategoryChips();

    // トグル・リセットボタンの更新
    dom.excludeToggle.disabled = state.isSpinning;
    dom.resetBtn.disabled = state.isSpinning || drawnTotal === 0;
    dom.drawnCount.textContent = String(drawnTotal);
    dom.drawnCount.hidden = drawnTotal === 0;

    // 抽選ボタンの活性制御
    const canDraw = !state.isSpinning && available.length > 0;
    dom.drawOneBtn.disabled = !canDraw;
    dom.drawFiveBtn.disabled = !canDraw;

    // 5個ボタンのサブ表示を残り件数に応じてわかりやすく調整
    const multiSub = dom.drawFiveBtn.querySelector('.draw-btn-sub');
    if (multiSub) {
      if (available.length > 0 && available.length < 5) {
        multiSub.textContent = `残り${available.length}件をすべて引く`;
      } else {
        multiSub.textContent = '小分類かぶり回避';
      }
    }

    // 全件出切り時の通知制御
    if (filtered.length > 0 && available.length === 0 && state.excludeDrawn) {
      showNotice(
        '選択中の領域はすべて出題済みです。リセットするか、別の領域を選んでください。',
        { showReset: true }
      );
    } else {
      hideNotice();
    }
  }

  /**
   * 結果カードDOMを生成する
   */
  function createResultCard(entry, index, totalCount) {
    const card = document.createElement('article');
    card.className = 'result-card';
    card.style.animationDelay = `${index * 60}ms`;
    applyCategoryStyle(card, entry.major);

    const body = document.createElement('div');
    body.className = 'card-body';

    // 上部メタ行（大分類バッジ + 連番）
    const meta = document.createElement('div');
    meta.className = 'card-meta';

    const badge = document.createElement('span');
    badge.className = 'category-badge';
    badge.textContent = entry.major;
    applyCategoryStyle(badge, entry.major);
    meta.appendChild(badge);

    if (totalCount > 1) {
      const num = document.createElement('span');
      num.className = 'card-index';
      num.textContent = `#${index + 1}`;
      meta.appendChild(num);
    }

    body.appendChild(meta);

    // 小分類 & 項目（項目が空欄なら小分類をメインタイトルに表示）
    const { minorLabel, titleText } = getDisplayParts(entry);
    if (minorLabel) {
      const minorEl = document.createElement('p');
      minorEl.className = 'card-minor';
      minorEl.textContent = minorLabel;
      body.appendChild(minorEl);
    }

    const titleEl = document.createElement('h3');
    titleEl.className = 'card-title';
    titleEl.textContent = titleText;
    body.appendChild(titleEl);

    card.appendChild(body);

    // 下部：答え合わせ（チェックリスト開閉）
    const footer = document.createElement('div');
    footer.className = 'card-footer';

    const hasChecklist = entry.checklist.length > 0;
    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'checklist-toggle-btn';

    if (hasChecklist) {
      const panelId = `checklist-panel-${entry.id}-${index}`;
      toggleBtn.setAttribute('aria-expanded', 'false');
      toggleBtn.setAttribute('aria-controls', panelId);

      const labelSpan = document.createElement('span');
      labelSpan.className = 'checklist-btn-label';
      labelSpan.textContent = '答え合わせ（チェックリストを表示）';

      const chevron = createChevronSvg();
      toggleBtn.append(labelSpan, chevron);

      const panel = document.createElement('div');
      panel.id = panelId;
      panel.className = 'checklist-panel';
      panel.setAttribute('aria-hidden', 'true');

      const panelInner = document.createElement('div');
      panelInner.className = 'checklist-panel-inner';

      const content = document.createElement('div');
      content.className = 'checklist-content';
      content.textContent = entry.checklist;

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

      footer.append(toggleBtn, panel);
    } else {
      toggleBtn.disabled = true;
      const labelSpan = document.createElement('span');
      labelSpan.className = 'checklist-btn-label';
      labelSpan.textContent = 'チェックリスト未登録';
      toggleBtn.appendChild(labelSpan);
      footer.appendChild(toggleBtn);
    }

    card.appendChild(footer);
    return card;
  }

  function createChevronSvg() {
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2.2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('checklist-chevron');

    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', 'm6 9 6 6 6-6');
    svg.appendChild(path);
    return svg;
  }

  function renderResults(results, requestedCount) {
    dom.resultList.textContent = '';

    dom.resultsHeading.textContent =
      requestedCount > 1 ? `抽選結果（${results.length}件）` : '抽選結果';

    // 5連のとき、小分類の重複回避結果をさりげなく表示
    if (requestedCount > 1 && results.length > 1) {
      const uniqueMinors = new Set(results.map((r) => r.minor || r.id)).size;
      dom.resultsMeta.textContent =
        uniqueMinors === results.length
          ? '小分類すべて別枠'
          : `小分類 ${uniqueMinors}種`;
    } else {
      dom.resultsMeta.textContent = '';
    }

    results.forEach((entry, idx) => {
      dom.resultList.appendChild(createResultCard(entry, idx, results.length));
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
      showNotice(
        '選択中の領域はすべて出題済みです。リセットするか、別の領域を選んでください。',
        { showReset: true, pulse: true }
      );
      return;
    }

    // 抽選結果を確定
    const results = drawFromPool(available, requestedCount);

    // 演出用プレビュー候補（残り1件のときはフィルター全体から演出すると動きが出る）
    const previewPool = available.length > 1 ? available : getFilteredItems();

    state.isSpinning = true;
    updateUI();

    dom.emptyState.hidden = true;
    dom.resultsWrapper.hidden = true;
    dom.shuffleStage.hidden = false;
    dom.shuffleStatus.textContent =
      requestedCount > 1
        ? `${Math.min(requestedCount, available.length)}件を抽選中...`
        : '抽選中...';
    dom.shuffleProgressBar.style.width = '0%';

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // 約1.15秒の軽快なシャッフル演出（動きを減らす設定時は短縮）
    const tickDelays = prefersReducedMotion
      ? [120, 140]
      : [65, 65, 70, 75, 80, 85, 95, 105, 115, 130, 145, 160];

    let step = 0;
    let lastPreviewId = null;

    const runStep = () => {
      if (step >= tickDelays.length) {
        // 演出完了：除外モードONなら出題済みに追加
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

      // 直前と同じ項目が続かないようにランダム選択
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

      // 登場順を保って大分類リストを自動抽出
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
        'data.csv の読み込みに失敗しました。ローカル環境の場合は簡易HTTPサーバーまたはGitHub Pages経由で開いてください。',
        { isError: true }
      );
      console.error('CSV load error:', error);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
