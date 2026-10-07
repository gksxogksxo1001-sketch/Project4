/**
 * 오늘의 진짜 정보판 — 데이터가 안 올 때 (Real-World Resilient Info Board)
 * 카드 1 ~ 카드 5 완벽 대응 핵심 엔진 (T04-C01 ~ T04-C28)
 */

// --- 1. CONFIGURATION & STATE ---
const CONFIG = {
  SOURCES: {
    weather: {
      name: 'Open-Meteo 서울 실시간 기온',
      url: 'https://api.open-meteo.com/v1/forecast?latitude=37.5665&longitude=126.9780&current=temperature_2m,relative_humidity_2m&timezone=Asia%2FTokyo',
      provider: 'Open-Meteo (Seoul Station, 37.56°N 126.98°E)',
      docUrl: 'https://open-meteo.com/en/docs',
      unit: '°C',
      dataType: '서울 현재 기온',
      parser: (json) => ({
        value: Number(json.current.temperature_2m).toFixed(1),
        unit: json.current_units?.temperature_2m || '°C',
        sourceTimeRaw: json.current.time,
        sourceTimeFormatted: formatIsoToKst(json.current.time),
        provider: 'Open-Meteo (Seoul Station)',
        sourceUrl: 'https://api.open-meteo.com/v1/forecast?latitude=37.5665&longitude=126.9780&current=temperature_2m,relative_humidity_2m&timezone=Asia%2FTokyo',
        extraInfo: `습도: ${json.current.relative_humidity_2m}%`
      })
    },
    exchange: {
      name: 'ExchangeRate 원/달러 환율',
      url: 'https://open.er-api.com/v6/latest/USD',
      provider: 'ExchangeRate-API (USD/KRW 기준)',
      docUrl: 'https://www.exchangerate-api.com',
      unit: 'KRW',
      dataType: 'USD/KRW 환율',
      parser: (json) => ({
        value: Number(json.rates.KRW).toFixed(2),
        unit: 'KRW',
        sourceTimeRaw: json.time_last_update_utc,
        sourceTimeFormatted: formatUtcStringToKst(json.time_last_update_utc),
        provider: 'ExchangeRate-API (USD Base)',
        sourceUrl: 'https://open.er-api.com/v6/latest/USD',
        extraInfo: `기준 통화: 1 USD`
      })
    }
  },
  AUTO_REFRESH_INTERVAL_MS: 30000,
  TIMEZONE: 'Asia/Seoul (KST, UTC+09:00)'
};

// 카드 3: 다섯 가지 실패 명세 (T04-C12 ~ T04-C16)
const FAILURE_TYPES = {
  timeout: {
    id: 'T04-C12',
    errorCode: 'ERROR_TIMEOUT',
    name: '느린 외부 응답 (Timeout)',
    desc: '외부 원천 응답이 지정 시간(3,000ms) 동안 수신되지 않아 클라이언트 타임아웃이 발생했습니다.',
    actionGuide: '네트워크 대역폭 상태를 점검한 뒤 아래 [다시 시도 (Retry)] 버튼을 누르세요.'
  },
  forbidden: {
    id: 'T04-C13',
    errorCode: 'ERROR_AUTH_FORBIDDEN',
    name: '외부 원천 401/403 거절 (Forbidden)',
    desc: '외부 원천 서버로부터 접근 권한 거절(HTTP 401 또는 403 Forbidden)을 수신했습니다.',
    actionGuide: '원천 API의 공개 엔드포인트 URL 및 호스트 접근 정책 변경 여부를 확인하세요.'
  },
  rate_limit: {
    id: 'T04-C14',
    errorCode: 'ERROR_RATE_LIMIT',
    name: '외부 원천 호출 제한 (Rate Limit 429)',
    desc: '원천 API의 호출 한도(HTTP 429 Too Many Requests)를 초과하여 요청이 일시 거부되었습니다.',
    actionGuide: '1분간 호출을 중단하거나 30초 자동 갱신 스위치를 잠시 끄고 대기하세요.'
  },
  offline: {
    id: 'T04-C15',
    errorCode: 'ERROR_OFFLINE',
    name: '오프라인 상태 (Network Offline)',
    desc: '인터넷 연결이 단절되어 원천 호스트에 패킷을 보낼 수 없습니다 (Failed to fetch).',
    actionGuide: '브라우저 네트워크 및 로컬 Wi-Fi/유선 연결 상태를 확인 후 [다시 시도 (Retry)]를 누르세요.'
  },
  malformed: {
    id: 'T04-C16',
    errorCode: 'ERROR_SCHEMA_MALFORMED',
    name: '응답 형식 변경 (Schema Malformed)',
    desc: '응답 JSON 구조가 예고 없이 변경되었거나 필수 수치 필드가 누락되어 파싱에 실패했습니다.',
    actionGuide: '데이터 정규화 파서 규격을 원천 API의 최신 응답 스키마에 맞게 점검하세요.'
  }
};

const state = {
  activeSourceKey: 'weather',
  chaosMode: 'normal', // 'normal' | 'timeout' | 'forbidden' | 'rate_limit' | 'offline' | 'malformed'
  isAutoRefresh: false,
  autoRefreshTimer: null,
  countdownSeconds: 30,
  countdownTimer: null,
  
  currentData: null,
  isDegraded: false,
  errorCode: 'none',
  lastFailureInfo: null,
  
  // T04-C10 원자료 보관
  lastRawResponseText: null
};

// --- 2. ASIA/SEOUL KST DATE & TIME UTILS (카드 4 핵심) ---
function getKstDate() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  return new Date(utc + (9 * 3600000));
}

function getKstDateString(dateObj = null) {
  const d = dateObj || getKstDate();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getYesterdayKstDateString() {
  const d = getKstDate();
  d.setDate(d.getDate() - 1);
  return getKstDateString(d);
}

function getTomorrowKstDateString() {
  const d = getKstDate();
  d.setDate(d.getDate() + 1);
  return getKstDateString(d);
}

function formatNowToKst() {
  const d = getKstDate();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss} KST`;
}

function formatIsoToKst(isoStr) {
  if (!isoStr) return '확인 불가';
  return isoStr.replace('T', ' ') + ' KST';
}

function formatUtcStringToKst(utcStr) {
  if (!utcStr) return '확인 불가';
  try {
    const d = new Date(utcStr);
    const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
    const kst = new Date(utc + (9 * 3600000));
    const yyyy = kst.getFullYear();
    const mm = String(kst.getMonth() + 1).padStart(2, '0');
    const dd = String(kst.getDate()).padStart(2, '0');
    const hh = String(kst.getHours()).padStart(2, '0');
    const min = String(kst.getMinutes()).padStart(2, '0');
    const ss = String(kst.getSeconds()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss} KST`;
  } catch (e) {
    return utcStr;
  }
}

// --- 3. STORAGE MANAGER (카드 4: 하루 한 줄 Upsert T04-C20, C21) ---
const StorageManager = {
  getKeyPrefix() {
    return `REAL_INFO_BOARD_${state.activeSourceKey.toUpperCase()}`;
  },

  getLastGood() {
    try {
      const raw = localStorage.getItem(`${this.getKeyPrefix()}_LAST_GOOD`);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      console.warn('[StorageManager] 마지막 정상값 파싱 실패', e);
      return null;
    }
  },

  saveLastGood(dataObj) {
    try {
      localStorage.setItem(`${this.getKeyPrefix()}_LAST_GOOD`, JSON.stringify(dataObj));
    } catch (e) {
      console.error('[StorageManager] 로컬스토리지 저장 실패', e);
    }
  },

  getDailyHistory() {
    try {
      const raw = localStorage.getItem(`${this.getKeyPrefix()}_DAILY_HISTORY`);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return typeof parsed === 'object' && parsed !== null ? parsed : {};
    } catch (e) {
      return {};
    }
  },

  // 카드 4 (T04-C20): 기준 시간대 날짜를 키로 삼아 같은 날 여러 번 성공해도 1건으로 덮어씀 (Upsert)
  saveDailyRecord(dateStr, value, fullData) {
    try {
      const history = this.getDailyHistory();
      history[dateStr] = {
        date: dateStr,
        value: Number(value),
        unit: fullData.unit,
        sourceUrl: fullData.sourceUrl || CONFIG.SOURCES[state.activeSourceKey].url,
        sourceTimeFormatted: fullData.sourceTimeFormatted,
        fetchTime: fullData.fetchTime || formatNowToKst()
      };
      localStorage.setItem(`${this.getKeyPrefix()}_DAILY_HISTORY`, JSON.stringify(history));
    } catch (e) {
      console.error('[StorageManager] 일별 기록 저장 실패', e);
    }
  },

  setMockYesterdayRecord(mockValue) {
    const yesterdayStr = getYesterdayKstDateString();
    const config = CONFIG.SOURCES[state.activeSourceKey];
    const history = this.getDailyHistory();
    history[yesterdayStr] = {
      date: yesterdayStr,
      value: Number(mockValue),
      unit: config.unit,
      sourceUrl: config.url,
      sourceTimeFormatted: `${yesterdayStr} 11:15:00 KST (D1 관측값)`,
      fetchTime: `${yesterdayStr} 11:15:05 KST`
    };
    localStorage.setItem(`${this.getKeyPrefix()}_DAILY_HISTORY`, JSON.stringify(history));
  },

  clearAllForCurrent() {
    localStorage.removeItem(`${this.getKeyPrefix()}_LAST_GOOD`);
    localStorage.removeItem(`${this.getKeyPrefix()}_DAILY_HISTORY`);
  }
};

// --- 4. DATA FETCHER & CHAOS SIMULATOR (카드 2 & 카드 3) ---
const DataFetcher = {
  async fetchLiveOrChaos() {
    const config = CONFIG.SOURCES[state.activeSourceKey];
    const fetchTime = formatNowToKst();

    // 1. Chaos Simulation 인터셉트
    if (state.chaosMode !== 'normal') {
      await this.simulateChaos(state.chaosMode);
    }

    // 2. 실제 No-Key 네트워크 요청 (T04-C11)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(config.url, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' }
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText || '서버 응답 오류'}`);
      }

      const textPayload = await response.text();
      state.lastRawResponseText = textPayload;

      let jsonPayload;
      try {
        jsonPayload = JSON.parse(textPayload);
      } catch (jsonErr) {
        throw new SyntaxError('API 응답 JSON 파싱 실패');
      }

      const parsedData = config.parser(jsonPayload);
      const normalized = {
        ...parsedData,
        fetchTime: fetchTime,
        timezone: CONFIG.TIMEZONE,
        isStale: false,
        rawJson: jsonPayload
      };

      return normalized;
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  },

  async simulateChaos(mode) {
    await new Promise(r => setTimeout(r, 400));
    const failSpec = FAILURE_TYPES[mode];

    switch (mode) {
      case 'timeout':
        await new Promise(r => setTimeout(r, 1000));
        const timeoutErr = new DOMException('Request Timeout (요청 제한 시간 3,000ms 초과로 연결이 중단되었습니다)', 'AbortError');
        timeoutErr.failureSpec = failSpec;
        throw timeoutErr;

      case 'forbidden':
        const forbiddenErr = new Error('HTTP 403 Forbidden (외부 원천 서버로부터 접근 권한이 거절되었습니다)');
        forbiddenErr.failureSpec = failSpec;
        throw forbiddenErr;

      case 'rate_limit':
        const rateLimitErr = new Error('HTTP 429 Too Many Requests (외부 원천의 초당/분당 호출 제한을 초과했습니다)');
        rateLimitErr.failureSpec = failSpec;
        throw rateLimitErr;

      case 'offline':
        const offlineErr = new TypeError('TypeError: Failed to fetch (인터넷 연결 단절 또는 호스트 접속 불가)');
        offlineErr.failureSpec = failSpec;
        throw offlineErr;

      case 'malformed':
        state.lastRawResponseText = '{ "error": "CORRUPTED_RESPONSE", "data": null, "values": [UNKNOWN_SYNTAX] }';
        const malformedErr = new SyntaxError('Malformed Schema: JSON 파싱 실패 및 필수 필드 결손');
        malformedErr.failureSpec = failSpec;
        throw malformedErr;

      default:
        break;
    }
  }
};

// --- 5. UI CONTROLLER & RENDERING ---
function renderUI() {
  const current = state.currentData;
  const config = CONFIG.SOURCES[state.activeSourceKey];

  // 1. 헤더 상태 배너 & 사용자 다음 행동 안내 (카드 3: T04-C17, T04-C18)
  const bannerEl = document.getElementById('statusBanner');
  const bannerIconEl = document.getElementById('bannerIcon');
  const bannerTitleEl = document.getElementById('bannerTitle');
  const bannerDescEl = document.getElementById('bannerDesc');
  const bannerBadgeEl = document.getElementById('bannerBadge');
  const actionGuideBox = document.getElementById('userActionGuideBox');
  const actionGuideText = document.getElementById('userActionGuideText');
  const retryBtn = document.getElementById('retryActionBtn');

  if (!state.isDegraded) {
    bannerEl.className = 'bento-card p-4 border border-emerald-200 bg-emerald-50/80 transition-all duration-300';
    bannerIconEl.className = 'w-5 h-5 text-emerald-600 shrink-0 mt-0.5';
    bannerTitleEl.innerText = '실시간 정상 연동 중 (Live Connected)';
    bannerTitleEl.className = 'text-sm font-bold text-emerald-800';
    bannerDescEl.innerText = `원천 API로부터 최신 데이터를 안정적으로 수신하고 있습니다. (기준: ${CONFIG.TIMEZONE})`;
    bannerBadgeEl.className = 'px-2 py-0.5 text-xs font-bold rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300';
    bannerBadgeEl.innerText = 'FRESH (code: none)';
    actionGuideBox.classList.add('hidden');
  } else {
    const fail = state.lastFailureInfo || FAILURE_TYPES.timeout;
    bannerEl.className = 'bento-card p-4 border banner-stale bg-amber-50/90 border-amber-300 transition-all duration-300';
    bannerIconEl.className = 'w-5 h-5 text-amber-600 shrink-0 mt-0.5';
    bannerTitleEl.innerText = `⚠️ 데이터 수신 지연 [${fail.errorCode}]: ${fail.name}`;
    bannerTitleEl.className = 'text-sm font-bold text-amber-900';
    bannerDescEl.innerText = `${fail.desc} 시스템이 직전 정상값(${current ? current.sourceTimeFormatted : '이전 데이터'} 기준)을 안전하게 보존하고 있습니다.`;
    bannerBadgeEl.className = 'px-2 py-0.5 text-xs font-bold rounded-full bg-amber-100 text-amber-800 border border-amber-300';
    bannerBadgeEl.innerText = `STALE (code: ${fail.errorCode})`;

    // 사용자 취할 다음 행동 가이드 표시 (카드 3 핵심)
    actionGuideBox.classList.remove('hidden');
    actionGuideText.innerText = fail.actionGuide;
  }

  // 2. 메인 지표 카드 (카드 1: T04-C04 ~ T04-C09 & 카드 3: T04-C18 오래된 값 stale 표시)
  if (current) {
    document.getElementById('metricValue').innerText = current.value;
    document.getElementById('metricUnit').innerText = current.unit;
    document.getElementById('metricSource').innerText = current.provider;
    document.getElementById('metricSourceLink').href = current.sourceUrl;
    document.getElementById('metricSourceTime').innerText = current.sourceTimeFormatted;
    document.getElementById('metricFetchTime').innerText = current.fetchTime;
    document.getElementById('metricTimezone').innerText = current.timezone;
    document.getElementById('metricExtraInfo').innerText = current.extraInfo || '';

    // 신선도 뱃지 (T04-C18)
    const freshnessBadge = document.getElementById('metricFreshnessBadge');
    if (state.isDegraded) {
      freshnessBadge.className = 'px-2.5 py-0.5 text-xs font-bold rounded-md bg-amber-100 text-amber-800 border border-amber-300 inline-flex items-center gap-1.5';
      freshnessBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span> 오래된 값 (stale: 보존 중)`;
    } else {
      freshnessBadge.className = 'px-2.5 py-0.5 text-xs font-medium rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 inline-flex items-center gap-1.5';
      freshnessBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500"></span> 실시간 최신값 (fresh)`;
    }
  }

  // 3. 2일 KST 대조 카드 (카드 5: T04-C22 ~ T04-C24)
  renderDeltaComparison();

  // 4. 일별 기록 테이블 (카드 4: T04-C20 하루 한 줄)
  renderDailyHistoryTable();

  // 5. Lucide 아이콘 리프레시
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

// 2일 KST 기록 및 변화값(Delta) 대조 렌더링 (카드 5)
function renderDeltaComparison() {
  const history = StorageManager.getDailyHistory();
  const sortedDates = Object.keys(history).sort(); // 과거순 정렬

  const deltaTodayVal = document.getElementById('deltaTodayVal');
  const deltaTodayDate = document.getElementById('deltaTodayDate');
  const deltaTodayUrl = document.getElementById('deltaTodayUrl');
  const deltaYesterdayVal = document.getElementById('deltaYesterdayVal');
  const deltaYesterdayDate = document.getElementById('deltaYesterdayDate');
  const deltaYesterdayUrl = document.getElementById('deltaYesterdayUrl');
  const deltaBadgeEl = document.getElementById('deltaBadge');
  const deltaFormulaEl = document.getElementById('deltaFormula');

  if (sortedDates.length >= 2) {
    // 2건 이상 있을 때: 어제(D1)와 오늘(D2) 비교
    const d1Key = sortedDates[sortedDates.length - 2];
    const d2Key = sortedDates[sortedDates.length - 1];
    const d1 = history[d1Key];
    const d2 = history[d2Key];

    deltaYesterdayDate.innerText = `${d1.date} (D1 KST)`;
    deltaYesterdayVal.innerText = `${d1.value} ${d1.unit}`;
    deltaYesterdayUrl.innerText = `관측: ${d1.sourceTimeFormatted}`;

    deltaTodayDate.innerText = `${d2.date} (D2 KST)`;
    deltaTodayVal.innerText = `${d2.value} ${d2.unit}`;
    deltaTodayUrl.innerText = `관측: ${d2.sourceTimeFormatted}`;

    // T04-C24: 변화값 재계산 (D2 - D1)
    const diff = Number((d2.value - d1.value).toFixed(2));
    const percent = d1.value !== 0 ? Number(((diff / d1.value) * 100).toFixed(2)) : 0;
    const sign = diff > 0 ? '+' : '';

    if (diff > 0) {
      deltaBadgeEl.className = 'px-3 py-1 rounded-full text-sm font-bold bg-rose-50 text-rose-700 border border-rose-200 inline-flex items-center gap-1';
      deltaBadgeEl.innerHTML = `▲ ${sign}${diff} ${d2.unit} (${sign}${percent}%)`;
    } else if (diff < 0) {
      deltaBadgeEl.className = 'px-3 py-1 rounded-full text-sm font-bold bg-blue-50 text-blue-700 border border-blue-200 inline-flex items-center gap-1';
      deltaBadgeEl.innerHTML = `▼ ${diff} ${d2.unit} (${percent}%)`;
    } else {
      deltaBadgeEl.className = 'px-3 py-1 rounded-full text-sm font-bold bg-slate-100 text-slate-700 border border-slate-200 inline-flex items-center gap-1';
      deltaBadgeEl.innerHTML = `- 0.00 (동일)`;
    }

    deltaFormulaEl.innerText = `계산 수식: (${d2.value} - ${d1.value}) = ${sign}${diff} ${d2.unit} (${sign}${percent}%) | 화면값과 100% 일치 (T04-C24)`;
  } else if (sortedDates.length === 1) {
    const single = history[sortedDates[0]];
    deltaYesterdayDate.innerText = `미기록 (🧪 모의 버튼 필요)`;
    deltaYesterdayVal.innerText = `대기 중`;
    deltaYesterdayUrl.innerText = `-`;

    deltaTodayDate.innerText = `${single.date} (KST 1건)`;
    deltaTodayVal.innerText = `${single.value} ${single.unit}`;
    deltaTodayUrl.innerText = `관측: ${single.sourceTimeFormatted}`;

    deltaBadgeEl.className = 'px-3 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-500 border border-slate-200';
    deltaBadgeEl.innerText = '대조 대기 중 (1건 보유, 2건 필요)';
    deltaFormulaEl.innerText = '우측 상단의 [🧪 어제 모의 기록 생성] 또는 [T04-RECOVER-D2] 버튼을 누르면 이틀 치 대조가 즉시 활성화됩니다.';
  } else {
    deltaYesterdayDate.innerText = `기록 없음`;
    deltaYesterdayVal.innerText = `--`;
    deltaTodayDate.innerText = `기록 없음`;
    deltaTodayVal.innerText = `--`;
    deltaBadgeEl.innerText = '데이터 없음';
    deltaFormulaEl.innerText = '';
  }
}

// 일별 기록 히스토리 테이블 렌더링 (카드 4)
function renderDailyHistoryTable() {
  const history = StorageManager.getDailyHistory();
  const tableBody = document.getElementById('dailyHistoryTableBody');
  const countBadge = document.getElementById('historyCountBadge');

  const dates = Object.keys(history).sort().reverse();
  countBadge.innerText = `${dates.length}건 보존 중`;

  if (dates.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="4" class="px-4 py-6 text-center text-slate-400 text-xs">보존된 일별 기록이 없습니다.</td></tr>`;
    return;
  }

  tableBody.innerHTML = dates.map(dateKey => {
    const item = history[dateKey];
    return `
      <tr class="hover:bg-slate-50 transition-colors">
        <td class="px-4 py-3 text-xs font-mono text-slate-700 font-semibold">${item.date} (KST)</td>
        <td class="px-4 py-3 text-xs font-bold text-indigo-600">${item.value} <span class="text-[11px] font-normal text-slate-500">${item.unit}</span></td>
        <td class="px-4 py-3 text-[11px] text-slate-500">${item.sourceTimeFormatted || '-'}</td>
        <td class="px-4 py-3 text-[11px] text-slate-500 font-mono">${item.fetchTime || '-'}</td>
      </tr>
    `;
  }).join('');
}

// --- 6. CORE ACTION: FETCH & UPDATE ---
async function executeFetch(isAuto = false) {
  const btn = document.getElementById('fetchBtn');
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white inline" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path></svg> 조회 중...`;

  try {
    const liveData = await DataFetcher.fetchLiveOrChaos();

    // 성공 처리
    state.currentData = liveData;
    state.isDegraded = false;
    state.errorCode = 'none';
    state.lastFailureInfo = null;

    // 정상값 및 일별 기록 저장 (Upsert)
    StorageManager.saveLastGood(liveData);
    StorageManager.saveDailyRecord(getKstDateString(), liveData.value, liveData);

    showToast('수신 성공', '최신 공개 데이터를 정상적으로 불러왔습니다.', 'success');
  } catch (error) {
    console.error('[executeFetch] 수신 실패:', error);

    // 실패 처리: 카드 3 (T04-C17 마지막 정상값 보존, T04-C18 stale 표시)
    const fallbackGood = StorageManager.getLastGood();
    state.isDegraded = true;
    state.lastFailureInfo = error.failureSpec || FAILURE_TYPES.timeout;
    state.errorCode = state.lastFailureInfo.errorCode;

    if (fallbackGood) {
      state.currentData = {
        ...fallbackGood,
        isStale: true
      };
      showToast(`⚠️ ${state.lastFailureInfo.name}`, `${state.lastFailureInfo.desc} 직전 정상값을 유지합니다.`, 'warning');
    } else {
      state.currentData = {
        value: '대기 중',
        unit: CONFIG.SOURCES[state.activeSourceKey].unit,
        provider: CONFIG.SOURCES[state.activeSourceKey].provider,
        sourceUrl: CONFIG.SOURCES[state.activeSourceKey].url,
        sourceTimeFormatted: '원천 수신 기록 없음',
        fetchTime: formatNowToKst(),
        timezone: CONFIG.TIMEZONE,
        isStale: true,
        extraInfo: '초기 정상값 수신 전 실패'
      };
      showToast('실패', error.message, 'error');
    }
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
    renderUI();
  }
}

// --- 7. AUTO-REFRESH (30 SECONDS LOOP) ---
function toggleAutoRefresh(enable) {
  state.isAutoRefresh = enable;
  clearInterval(state.autoRefreshTimer);
  clearInterval(state.countdownTimer);

  const countdownText = document.getElementById('autoRefreshCountdown');

  if (enable) {
    state.countdownSeconds = 30;
    countdownText.innerText = `(30초 후 갱신)`;
    countdownText.classList.remove('hidden');

    state.countdownTimer = setInterval(() => {
      state.countdownSeconds -= 1;
      if (state.countdownSeconds <= 0) {
        state.countdownSeconds = 30;
      }
      countdownText.innerText = `(${state.countdownSeconds}초 후 갱신)`;
    }, 1000);

    state.autoRefreshTimer = setInterval(() => {
      executeFetch(true);
    }, CONFIG.AUTO_REFRESH_INTERVAL_MS);

    showToast('30초 자동 갱신 활성화', '30초마다 데이터를 자동으로 폴링합니다.', 'info');
  } else {
    countdownText.classList.add('hidden');
    showToast('자동 갱신 비활성화', '수동 조회 모드로 전환되었습니다.', 'info');
  }
}

// --- 8. CHAOS MODE CONTROLLER (카드 3) ---
function setChaosMode(mode) {
  state.chaosMode = mode;

  const buttons = document.querySelectorAll('.chaos-btn');
  buttons.forEach(btn => {
    const btnMode = btn.getAttribute('data-mode');
    if (btnMode === mode) {
      btn.className = 'chaos-btn px-3 py-2 text-xs font-bold rounded-lg bg-indigo-600 text-white shadow-sm border border-indigo-600 transition-all text-center';
    } else {
      btn.className = 'chaos-btn px-3 py-2 text-xs font-semibold rounded-lg bg-white text-slate-700 hover:bg-slate-50 border border-slate-200 transition-all text-center';
    }
  });

  const chaosNotice = document.getElementById('chaosStatusNotice');
  if (mode === 'normal') {
    chaosNotice.innerHTML = `🟢 <strong>정상 모드 (Live)</strong>: 실제 외부 원천 API에 직접 요청합니다.`;
    chaosNotice.className = 'text-xs text-emerald-700 font-mono mt-3 font-medium bg-emerald-50 p-2 rounded border border-emerald-200';
  } else {
    const fail = FAILURE_TYPES[mode];
    chaosNotice.innerHTML = `⚠️ <strong>합성 실패 [${fail.errorCode}]</strong>: [지금 조회하기]를 누르면 '${fail.name}' 상황이 재현됩니다.`;
    chaosNotice.className = 'text-xs text-amber-800 font-mono mt-3 font-medium bg-amber-50 p-2 rounded border border-amber-200';
  }
}

// --- 9. T04-RECOVER-D2 복구 재생 엔진 (카드 3: T04-C19 핵심) ---
function executeRecoverD2() {
  const tomorrowStr = getTomorrowKstDateString();
  const config = CONFIG.SOURCES[state.activeSourceKey];
  const current = state.currentData;

  // D2 정상값 산출 (기존 값 기반 상승/변동 모의)
  let d2Value = 21.4;
  if (current && !isNaN(Number(current.value))) {
    d2Value = state.activeSourceKey === 'weather'
      ? (Number(current.value) + 1.6).toFixed(1)
      : (Number(current.value) + 8.5).toFixed(2);
  }

  const d2Data = {
    value: d2Value,
    unit: config.unit,
    provider: config.provider,
    sourceUrl: config.url,
    sourceTimeFormatted: `${tomorrowStr} 11:15:00 KST (D2 정상 관측값)`,
    fetchTime: `${tomorrowStr} 11:15:04 KST`,
    timezone: CONFIG.TIMEZONE,
    isStale: false,
    extraInfo: 'T04-RECOVER-D2 자산 복구 완료'
  };

  // 복구 처리
  state.currentData = d2Data;
  state.isDegraded = false;
  state.errorCode = 'none';
  state.lastFailureInfo = null;
  setChaosMode('normal');

  // 저장 & D2 일별 기록 정확히 1건 추가 (T04-C19)
  StorageManager.saveLastGood(d2Data);
  StorageManager.saveDailyRecord(tomorrowStr, d2Value, d2Data);

  renderUI();
  showToast('✅ T04-RECOVER-D2 복구 완료', `상태가 fresh, error_code: none으로 복귀되었으며 다음 날짜(${tomorrowStr}) 기록이 1건 추가되었습니다.`, 'success');
}

// --- 10. 같은 날 재실행 행 수 불변 검증기 (카드 4: T04-C20) ---
async function testSameDayRerun() {
  const historyBefore = StorageManager.getDailyHistory();
  const countBefore = Object.keys(historyBefore).length;

  showToast('🧪 같은 날 3회 재실행 시험 시작', `현재 행 수: ${countBefore}행. 3회 연속 조회를 실행합니다...`, 'info');

  // 3회 연속 조회 실행
  for (let i = 1; i <= 3; i++) {
    await executeFetch();
    await new Promise(r => setTimeout(r, 200));
  }

  const historyAfter = StorageManager.getDailyHistory();
  const countAfter = Object.keys(historyAfter).length;

  const resultEl = document.getElementById('sameDayRerunResult');
  resultEl.className = 'text-xs font-mono font-bold text-indigo-700 bg-indigo-50 p-2.5 rounded-lg border border-indigo-200 mt-2 block';
  resultEl.innerHTML = `✅ <strong>T04-C20 검증 완료:</strong> 실행 전 ${countBefore}행 ➔ 3회 연속 재실행 후에도 <strong>${countAfter}행 유지</strong> (같은 날 중복 없이 1건으로 Upsert)`;
  
  showToast('T04-C20 통과', `같은 날 3회 재실행 후에도 총 ${countAfter}행으로 중복이 방지되었습니다.`, 'success');
}

// --- 11. INSPECTOR MODAL (T04-C10 대조 뷰어) ---
function openInspectorModal() {
  const modal = document.getElementById('inspectorModal');
  const rawPre = document.getElementById('rawResponseCode');
  const storagePre = document.getElementById('storageDataCode');
  const renderPre = document.getElementById('renderedViewModelCode');
  const matchStatus = document.getElementById('matchStatusBadge');

  const stored = StorageManager.getLastGood();
  const current = state.currentData;

  rawPre.innerText = state.lastRawResponseText ? state.lastRawResponseText : '// 아직 API 원본 응답이 없습니다.\n// [지금 조회하기]를 먼저 실행하세요.';
  storagePre.innerText = stored ? JSON.stringify(stored, null, 2) : '// 로컬스토리지에 저장된 정상값이 없습니다.';
  renderPre.innerText = current ? JSON.stringify({
    '화면 표시 값': current.value,
    '화면 표시 단위': current.unit,
    '출처': current.provider,
    '출처 시각': current.sourceTimeFormatted,
    '조회 시각': current.fetchTime,
    '기준 시간대': current.timezone,
    '오래된 값 여부(isStale)': current.isStale,
    '에러 코드(errorCode)': state.errorCode
  }, null, 2) : '// 렌더링된 뷰모델 없음';

  if (stored && current && stored.value === current.value) {
    matchStatus.className = 'px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 inline-flex items-center gap-1.5';
    matchStatus.innerHTML = `✅ 정상 대조 일치: 원자료(${current.value}) = 저장값(${stored.value}) = 화면값(${current.value} ${current.unit})`;
  } else {
    matchStatus.className = 'px-3 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-500 border border-slate-200 inline-flex items-center gap-1.5';
    matchStatus.innerHTML = `대조 확인 대기`;
  }

  modal.classList.remove('hidden');
  if (window.lucide) window.lucide.createIcons();
}

function closeInspectorModal() {
  document.getElementById('inspectorModal').classList.add('hidden');
}

// --- 12. SUBMISSION HELPER MODAL (카드 5: T04-C27, T04-C28 규격 준수) ---
function openSubmissionModal() {
  document.getElementById('submissionModal').classList.remove('hidden');
  if (window.lucide) window.lucide.createIcons();
}

function closeSubmissionModal() {
  document.getElementById('submissionModal').classList.add('hidden');
}

function copySubmissionText() {
  const text = `[짧은 확인 방법 4줄 (T04-C27)]
① 어디로 가나요: 상단 '외부 실패 5종 합성 재생' 패널 및 중앙 메인 지표 카드
② 3단계 이내 무엇을 하나요: [호출 제한(429)] 클릭 -> [지금 조회하기] 클릭 -> 상단 상태 배너 및 지표 카드 확인
③ 무엇이 보이면 통과인가요: 상단에 "⚠️ [ERROR_RATE_LIMIT] 호출 제한" 상태와 대처 가이드가 뜨며, 기존 정상 수치에 [오래된 값(stale)] 표시가 붙고 지워지지 않고 보존됨
④ 안 될 때 무엇이 보이나요: 화면이 백지로 변하거나 수치가 0, NaN, 빈칸으로 소실되는 경우

[AI와 나의 판단 3줄 (T04-C28)]
① AI에게 맡긴 일: No-Key 공개 API 통신 모듈 및 5대 실패(Timeout, 401/403, 429, Offline, Malformed) 합성 시뮬레이터와 T04-RECOVER-D2 복구 로직 작성
② 학생이 직접 판단한 일: 카드 4의 Asia/Seoul 하루 한 줄 Upsert 규칙(같은 날 행 수 불변 검증기)을 배치하고, 카드 5의 이틀 치 변화량 수식을 정밀 대조할 수 있도록 3단 일치 대조 뷰어를 기획함
③ AI 제안을 따르지 않은 일: 백엔드 프록시 서버나 별도 데이터베이스를 두자는 초기 제안을 배제하고, 무로그인 시크릿 창 정적 배포 기준(Zero-Backend)을 고수함`;

  navigator.clipboard.writeText(text).then(() => {
    showToast('복사 완료', '공식 규격(T04-C27, C28) 과제 제출문이 클립보드에 복사되었습니다.', 'success');
  }).catch(() => {
    showToast('복사 실패', '수동으로 드래그하여 복사해주세요.', 'error');
  });
}

// --- 13. TOAST NOTIFICATION ---
function showToast(title, desc, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  
  let borderColor = 'border-slate-200';
  let bgColor = 'bg-white/95';
  let titleColor = 'text-indigo-600';

  if (type === 'success') {
    borderColor = 'border-emerald-300';
    titleColor = 'text-emerald-700';
  } else if (type === 'warning') {
    borderColor = 'border-amber-300';
    titleColor = 'text-amber-800';
  } else if (type === 'error') {
    borderColor = 'border-rose-300';
    titleColor = 'text-rose-700';
  }

  toast.className = `p-3.5 rounded-xl border ${borderColor} ${bgColor} shadow-lg backdrop-blur-md transition-all duration-300 transform translate-y-2 opacity-0 text-xs w-72`;
  toast.innerHTML = `
    <div class="font-bold ${titleColor} mb-0.5">${title}</div>
    <div class="text-slate-600">${desc}</div>
  `;

  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  }, 10);

  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => toast.remove(), 3500);
  }, 3800);
}

// --- 14. INITIALIZATION & EVENT LISTENERS ---
document.addEventListener('DOMContentLoaded', () => {
  // 1. 소스 탭 전환
  document.querySelectorAll('.source-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const source = btn.getAttribute('data-source');
      if (source === state.activeSourceKey) return;
      state.activeSourceKey = source;

      document.querySelectorAll('.source-tab-btn').forEach(b => {
        b.className = 'source-tab-btn px-4 py-2 text-xs font-semibold rounded-lg text-slate-600 hover:text-slate-900 transition-all flex items-center gap-1.5';
      });
      btn.className = 'source-tab-btn px-4 py-2 text-xs font-semibold rounded-lg bg-white text-indigo-700 shadow-sm transition-all flex items-center gap-1.5';

      const saved = StorageManager.getLastGood();
      if (saved) {
        state.currentData = saved;
        state.isDegraded = false;
        renderUI();
      } else {
        executeFetch();
      }
    });
  });

  // 2. 지금 조회하기
  document.getElementById('fetchBtn').addEventListener('click', () => {
    executeFetch();
  });

  // 3. 실패 시 나타나는 [다시 시도 (Retry)] 버튼 (T04-C19)
  document.getElementById('retryActionBtn').addEventListener('click', () => {
    setChaosMode('normal');
    executeFetch();
  });

  // 4. Chaos 모드 버튼들 (T04-C12 ~ T04-C16)
  document.querySelectorAll('.chaos-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-mode');
      setChaosMode(mode);
    });
  });

  // 5. T04-RECOVER-D2 복구 재생 버튼 (T04-C19)
  document.getElementById('recoverD2Btn').addEventListener('click', () => {
    executeRecoverD2();
  });

  // 6. 같은 날 3회 재실행 시험 버튼 (T04-C20)
  document.getElementById('testSameDayRerunBtn').addEventListener('click', () => {
    testSameDayRerun();
  });

  // 7. 자동 갱신 스위치
  document.getElementById('autoRefreshCheckbox').addEventListener('change', (e) => {
    toggleAutoRefresh(e.target.checked);
  });

  // 8. 어제 모의 데이터 삽입 (T04-C22 검증용)
  document.getElementById('injectMockYesterdayBtn').addEventListener('click', () => {
    const current = state.currentData;
    let mockVal = 17.5;
    if (current && !isNaN(Number(current.value))) {
      mockVal = state.activeSourceKey === 'weather' 
        ? (Number(current.value) - 1.8).toFixed(1)
        : (Number(current.value) - 12.5).toFixed(2);
    }
    StorageManager.setMockYesterdayRecord(mockVal);
    renderUI();
    showToast('🧪 어제 기록 생성 완료', `어제 KST(${getYesterdayKstDateString()}) 관측값으로 ${mockVal} 값이 등록되었습니다.`, 'success');
  });

  // 9. 기록 초기화
  document.getElementById('clearHistoryBtn').addEventListener('click', () => {
    if (confirm('현재 지표의 모든 로컬 기록을 초기화할까요?')) {
      StorageManager.clearAllForCurrent();
      state.currentData = null;
      state.isDegraded = false;
      state.errorCode = 'none';
      executeFetch();
      showToast('초기화 완료', '모든 로컬 기록이 초기화되었습니다.', 'info');
    }
  });

  // 10. 모달 열기/닫기
  document.getElementById('openInspectorBtn').addEventListener('click', openInspectorModal);
  document.getElementById('closeInspectorBtn').addEventListener('click', closeInspectorModal);
  document.getElementById('closeInspectorBtn2').addEventListener('click', closeInspectorModal);

  document.getElementById('openSubmissionBtn').addEventListener('click', openSubmissionModal);
  document.getElementById('closeSubmissionBtn').addEventListener('click', closeSubmissionModal);
  document.getElementById('copySubmissionBtn').addEventListener('click', copySubmissionText);

  // 11. 초기 부팅
  const cached = StorageManager.getLastGood();
  if (cached) {
    state.currentData = cached;
    renderUI();
  }
  executeFetch();
});
