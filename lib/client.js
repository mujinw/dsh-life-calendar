/**
 * 人生日历 · Client 半
 * ==============================
 * 注册两个 Slot：
 *   sidebar.panellist  id = 'life-calendar'  → 左侧边栏「人生日历」图标
 *   main              key = 'life-calendar'  → 主面板：一生格 / 年视图 / 月视图 / 事件增删改
 *
 * 数据经 DSH 认证共享 API（/api life-calendar）从 host 半取得；本文件零依赖，
 * 由 window.__ModuleLoader__ 加载，React 走 require('react')。
 */

window.__ModuleLoader__.load({
	id: 'dsh-life-calendar',
	factory: (require) => {
		const React = require('react')
		const h = React.createElement
		const { useState, useEffect, useMemo, useCallback, useRef } = React

		const PACKAGE_ID = 'dsh-life-calendar'
		const PANEL_ID = 'life-calendar'
		const ENDPOINT = 'life-calendar'
		const PANEL_LABEL = '人生日历'

		const KINDS = [
			['milestone', '里程碑'],
			['work', '事业'],
			['study', '学习'],
			['family', '家人'],
			['health', '身体'],
			['travel', '远行'],
			['invest', '投资'],
			['other', '其他'],
		]
		const KIND_LABEL = {}
		KINDS.forEach((k) => { KIND_LABEL[k[0]] = k[1] })

		/* ────────────────────────── 日期工具 ────────────────────────── */
		const pad2 = (n) => (n < 10 ? '0' : '') + n
		const ymd = (d) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
		const parseYmd = (s) => {
			const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''))
			if (!m) return null
			const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
			return Number.isNaN(d.getTime()) ? null : d
		}
		const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }
		/** 生日口径的周岁：今年生日过了没有。 */
		const ageOn = (birth, d) => {
			if (!birth) return null
			let a = d.getFullYear() - birth.getFullYear()
			if (d.getMonth() < birth.getMonth()
				|| (d.getMonth() === birth.getMonth() && d.getDate() < birth.getDate())) a -= 1
			return Math.max(0, a)
		}
		const yearProgress = (d) => {
			const start = new Date(d.getFullYear(), 0, 1)
			const end = new Date(d.getFullYear() + 1, 0, 1)
			return (d - start) / (end - start)
		}
		/** 今年还剩几天（含今天）。 */
		const daysLeftThisYear = (d) => {
			const end = new Date(d.getFullYear() + 1, 0, 1)
			return Math.max(0, Math.round((end - d) / 86400000))
		}

		/* ────────────────────────── RPC ────────────────────────── */
		async function callApi(ctx, payload) {
			if (!ctx || !ctx.connection || !ctx.connection.rpc || typeof ctx.connection.rpc.call !== 'function') {
				throw new Error('连接不可用，刷新页面再试。')
			}
			const carrier = await ctx.connection.rpc.call('/api', ENDPOINT, payload, undefined)
			if (carrier && carrier.ok === true) return carrier.value
			const error = (carrier && carrier.error) || {}
			const err = new Error(error.message || '请求失败')
			err.code = error.code || 'rpc-failed'
			throw err
		}

		/* ────────────────────────── 样式 ────────────────────────── */
		const CSS = `
.lc { height: 100%; overflow: auto; padding: 22px 28px 40px; color: var(--color-text, #1c1b19);
  font-size: 13px; line-height: 1.55; -webkit-font-smoothing: antialiased; }
.lc-inner { max-width: 940px; margin: 0 auto; }
.lc button { font: inherit; color: inherit; cursor: pointer; }
.lc-head { display: flex; align-items: flex-end; gap: 14px; padding-bottom: 14px; }
.lc-head h1 { margin: 0; font-size: 18px; font-weight: 700; letter-spacing: .01em; }
.lc-sub { margin: 2px 0 0; font-size: 11.5px; color: var(--color-faint, #8f8f87); }
.lc-head-right { margin-left: auto; display: flex; gap: 16px; align-items: baseline; }
.lc-stat { font-size: 11.5px; color: var(--color-faint, #8f8f87); white-space: nowrap; }
.lc-stat b { font-size: 15px; font-weight: 700; color: var(--color-text, #1c1b19); margin-right: 3px;
  font-variant-numeric: tabular-nums; }
.lc-link { background: none; border: 0; padding: 0; font-size: 11.5px; color: var(--color-faint, #8f8f87);
  text-decoration: underline; text-underline-offset: 2px; }
.lc-link:hover { color: var(--color-text, #1c1b19); }

.lc-life { border: 1px solid var(--color-border, #ececea); border-radius: 10px; background: #fff;
  padding: 16px 18px 14px; margin-bottom: 16px; }
.lc-hero { display: flex; gap: 30px; align-items: flex-start; }
.lc-hero-side { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; padding-top: 2px; }
.lc-rows { display: flex; flex-direction: column; gap: 5px; flex: none; }
.lc-row { display: flex; align-items: center; gap: 5px; }
.lc-age { width: 20px; flex: none; text-align: right; padding-right: 5px; font-size: 9.5px;
  color: #c2bfb6; font-variant-numeric: tabular-nums; }
.lc-cell { width: 20px; height: 20px; flex: none; border-radius: 3px; border: 1px solid transparent;
  background: #efece6; padding: 0; position: relative; transition: transform .08s ease; }
.lc-cell.future { background: #fff; border: 1px dashed #e6e2da; }
.lc-cell.past { background: #e2ded5; }
.lc-cell.current { background: #fff; border: 1.5px solid #b45309; }
.lc-cell.sel { box-shadow: 0 0 0 2px #0f7a5a; }
.lc-cell:hover { transform: translateY(-1px); }
.lc-figs { display: flex; gap: 24px; flex-wrap: wrap; align-items: baseline; }
.lc-fig { font-size: 11px; color: var(--color-faint, #8f8f87); white-space: nowrap; }
.lc-fig b { font-size: 26px; font-weight: 700; color: var(--color-text, #1c1b19); margin-right: 4px;
  font-variant-numeric: tabular-nums; letter-spacing: -.01em; }
.lc-fig.warm b { color: #b45309; }
.lc-legend { display: flex; gap: 13px; align-items: center; font-size: 10.5px;
  color: var(--color-faint, #8f8f87); flex-wrap: wrap; }
.lc-legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 5px;
  vertical-align: -1px; }
.lc-motto { margin: 0; font-size: 12.5px; line-height: 1.7; color: #45443f; max-width: 480px; }
.lc-motto b { color: #b45309; font-weight: 700; }

.lc-sec-head { display: flex; align-items: center; gap: 10px; margin: 18px 0 9px; }
.lc-sec-head h2 { margin: 0; font-size: 14px; font-weight: 700; }
.lc-sec-head .dim { font-size: 11.5px; color: var(--color-faint, #8f8f87); font-weight: 400; }
.lc-sec-head .right { margin-left: auto; display: flex; gap: 8px; align-items: center; }
.lc-nav { border: 1px solid var(--color-border, #ececea); background: #fff; border-radius: 6px;
  width: 24px; height: 24px; line-height: 1; font-size: 13px; color: #6b6b64; }
.lc-nav:hover { border-color: #cfcbc2; color: #1c1b19; }
.lc-btn { border: 1px solid var(--color-border, #ececea); background: #fff; border-radius: 6px;
  padding: 4px 10px; font-size: 11.5px; color: #45443f; }
.lc-btn:hover { border-color: #cfcbc2; }
.lc-btn.primary { background: #1c1b19; border-color: #1c1b19; color: #fff; }
.lc-btn.primary:hover { background: #000; }
.lc-btn.ghost { border-color: transparent; background: transparent; color: var(--color-faint, #8f8f87); }
.lc-btn.ghost:hover { color: #b45309; }
.lc-btn.danger { color: #b91c1c; border-color: #f3d6d2; }
.lc-btn.danger:hover { background: #fef2f2; }

.lc-months { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; }
.lc-month { text-align: left; border: 1px solid var(--color-border, #ececea); background: #fff;
  border-radius: 8px; padding: 8px 9px; min-width: 0; transition: border-color .1s; }
.lc-month:hover { border-color: #cfcbc2; }
.lc-month.sel { border-color: #0f7a5a; box-shadow: inset 0 0 0 1px #0f7a5a; }
.lc-month.empty { background: #fcfbf9; }
.lc-mtop { display: flex; align-items: baseline; gap: 6px; }
.lc-mtop b { font-size: 12px; font-weight: 700; }
.lc-mtop span { font-size: 10px; color: var(--color-faint, #8f8f87); margin-left: auto;
  font-variant-numeric: tabular-nums; }
.lc-mtitle { font-size: 10.5px; color: #a3a09a; white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis; margin-top: 2px; }
.lc-month.has .lc-mtitle { color: #6b6b64; }

.lc-events { margin-top: 6px; }
.lc-list { border: 1px solid var(--color-border, #ececea); border-radius: 10px; background: #fff;
  overflow: hidden; }
.lc-ghead { display: flex; align-items: baseline; gap: 8px; padding: 8px 12px 6px; background: #faf9f6; }
.lc-g + .lc-g .lc-ghead { border-top: 1px solid #f4f2ee; }
.lc-gyear { background: none; border: 0; padding: 0; font-size: 11.5px; font-weight: 700;
  color: #6b6b64; font-variant-numeric: tabular-nums; }
.lc-gyear:hover { color: #b45309; }
.lc-ghead .dim { font-size: 10.5px; color: #a3a09a; }
.lc-filters { display: flex; gap: 6px; flex-wrap: wrap; margin: 0 0 10px; }
.lc-chip { border: 1px solid var(--color-border, #ececea); background: #fff; border-radius: 999px;
  padding: 3px 10px; font-size: 11px; color: #6b6b64; white-space: nowrap; }
.lc-chip:hover { border-color: #cfcbc2; color: #1c1b19; }
.lc-chip.on { background: #1c1b19; border-color: #1c1b19; color: #fff; }
.lc-chip i { font-style: normal; opacity: .55; margin-left: 4px; font-variant-numeric: tabular-nums; }
.lc-ev { display: flex; align-items: baseline; gap: 10px; padding: 9px 12px; }
.lc-ev + .lc-ev { border-top: 1px solid #f4f2ee; }
.lc-ev:hover { background: #fcfbf9; }
.lc-ev-date { font-size: 11px; color: var(--color-faint, #8f8f87); width: 70px; flex: none;
  font-variant-numeric: tabular-nums; }
.lc-ev-main { min-width: 0; flex: 1; }
.lc-ev-main b { font-size: 12.5px; font-weight: 600; }
.lc-ev-note { display: block; font-size: 11px; color: #8f8f87; margin-top: 1px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lc-star { color: #b45309; font-size: 10px; flex: none; }
.lc-tag { font-size: 10px; color: #6b6b64; background: #f4f2ee; border-radius: 4px; padding: 1px 6px;
  flex: none; }
.lc-ops { display: flex; gap: 4px; flex: none; opacity: 0; transition: opacity .1s; }
.lc-ev:hover .lc-ops { opacity: 1; }

.lc-form { border: 1px solid #dcd8cf; border-radius: 10px; background: #fcfbf9; padding: 12px;
  margin-bottom: 10px; display: flex; flex-direction: column; gap: 8px; }
.lc-frow { display: flex; gap: 8px; align-items: center; }
.lc-frow.top { margin-top: 8px; }
.lc-form input[type=date], .lc-form input[type=text], .lc-form select, .lc-form textarea {
  font: inherit; font-size: 12px; border: 1px solid #e2dfd8; border-radius: 6px; padding: 5px 8px;
  background: #fff; color: inherit; outline: none; }
.lc-form input[type=date]:focus, .lc-form input[type=text]:focus, .lc-form select:focus,
.lc-form textarea:focus { border-color: #b45309; }
.lc-form input[type=text] { flex: 1; min-width: 0; }
.lc-form textarea { resize: vertical; min-height: 46px; }
.lc-card { border: 1px solid #dcd8cf; border-radius: 10px; background: #fcfbf9; padding: 12px;
  margin: 2px 0 10px; display: flex; flex-direction: column; gap: 8px; }
.lc-card input[type=text], .lc-card textarea { font: inherit; font-size: 12px; border: 1px solid #e2dfd8;
  border-radius: 6px; padding: 5px 8px; background: #fff; color: inherit; outline: none; }
.lc-card input[type=text]:focus, .lc-card textarea:focus { border-color: #b45309; }
.lc-card input[type=text] { flex: 1; min-width: 0; }
.lc-ta { resize: vertical; min-height: 76px; line-height: 1.75; flex: 1; min-width: 0; }
.lc-card input[type=date] { font: inherit; font-size: 12px; border: 1px solid #e2dfd8;
  border-radius: 6px; padding: 5px 8px; background: #fff; color: inherit; }
.lc-flabel { font-size: 11.5px; color: #8f8f87; width: 34px; flex: none; }
.lc-hint { margin-left: auto; font-size: 10.5px; color: #a3a09a; }
.lc-check { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; color: #6b6b64; }
.lc-form-err { font-size: 11.5px; color: #b91c1c; }
.lc-empty { border: 1px dashed #e2dfd8; border-radius: 10px; padding: 22px 12px; text-align: center;
  color: var(--color-faint, #8f8f87); font-size: 12px; background: #fcfbf9; }
.lc-banner { border: 1px solid #f3d6d2; background: #fef6f5; color: #8a2b22; border-radius: 8px;
  padding: 8px 12px; font-size: 12px; margin-bottom: 12px; display: flex; gap: 10px; align-items: center; }
.lc-setup { border: 1px solid var(--color-border, #ececea); border-radius: 10px; background: #fcfbf9;
  padding: 18px; max-width: 460px; }
.lc-setup h2 { margin: 0 0 6px; font-size: 14px; }
.lc-setup p { margin: 0 0 12px; font-size: 11.5px; color: #6b6b64; }

/* 人生阶段 */
.lc-bandwrap { border: 1px solid var(--color-border, #ececea); border-radius: 10px; background: #fff;
  padding: 10px; }
.lc-band { display: flex; height: 42px; border-radius: 7px; overflow: hidden; background: #fbfaf7; }
.lc-seg { border: 0; margin: 0; min-width: 0; display: flex; flex-direction: column; justify-content: center;
  gap: 2px; padding: 0 9px; text-align: left; cursor: pointer; color: #fff; font: inherit; }
.lc-seg + .lc-seg { border-left: 1px solid rgba(255,255,255,.6); }
.lc-seg b { font-size: 11.5px; font-weight: 600; white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis; }
.lc-seg span { font-size: 9.5px; opacity: .82; white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
.lc-seg.gap { background: repeating-linear-gradient(45deg, #fbfaf7, #fbfaf7 5px, #f2efe9 5px, #f2efe9 10px);
  color: #a3a09a; }
.lc-seg.gap:hover { color: #b45309; }
.lc-seg.on { box-shadow: inset 0 0 0 2px #1c1b19; }
.lc-runner { display: flex; justify-content: space-between; font-size: 10px; color: #a3a09a;
  margin-top: 6px; font-variant-numeric: tabular-nums; }
.lc-stagerow { display: flex; align-items: center; gap: 9px; padding: 8px 2px; cursor: pointer; }
.lc-stagerow + .lc-stagerow { border-top: 1px solid #f4f2ee; }
.lc-stagerow:hover { background: #fcfbf9; }
.lc-stagerow.on { background: #fbf6ee; }
.lc-sdot { width: 9px; height: 9px; border-radius: 3px; flex: none; }
.lc-sname { font-size: 12.5px; font-weight: 600; flex: none; }
.lc-srange { font-size: 11px; color: #8f8f87; flex: none; font-variant-numeric: tabular-nums; }
.lc-snote { font-size: 11px; color: #8f8f87; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; min-width: 0; }
.lc-stagerow .lc-ops { margin-left: auto; opacity: .45; transition: opacity .1s; }
.lc-stagerow:hover .lc-ops { opacity: 1; }
.lc-fold { cursor: pointer; user-select: none; }
.lc-fold h2 { display: inline-flex; align-items: center; gap: 6px; }
.lc-fold .lc-caret { font-size: 9px; color: #a3a09a; transition: transform .12s; display: inline-block; }
.lc-fold.open .lc-caret { transform: rotate(90deg); }
.lc-mile { border-top: 1px solid #f4f2ee; }
.lc-ms { display: flex; align-items: baseline; gap: 9px; padding: 7px 2px; cursor: pointer; }
.lc-ms + .lc-ms { border-top: 1px dashed #f4f2ee; }
.lc-ms:hover { background: #fcfbf9; }
.lc-ms-when { font-size: 10.5px; color: #a3a09a; width: 86px; flex: none;
  font-variant-numeric: tabular-nums; }
.lc-ms-main { min-width: 0; flex: 1; }
.lc-ms-main b { font-size: 12.5px; font-weight: 600; }
.lc-mslist { padding: 2px 0 12px; }
/* 人生战略：整页唯一的「聚焦」块，只放一句判据 */
.lc-focus { position: relative; margin: 28px 0 16px; padding: 28px 34px 26px;
  border-radius: 16px; text-align: center; border: 1px solid #f0e4d1;
  background: linear-gradient(180deg, #fdfaf4 0%, #faf4ea 100%);
  box-shadow: 0 12px 28px -22px rgba(120, 85, 30, .55); }
.lc-focus-label { font-size: 9.5px; letter-spacing: .3em; color: #b45309; }
.lc-focus-body { margin: 12px auto 0; max-width: 620px; font-size: 16.5px; line-height: 1.95;
  color: #221d16; font-weight: 500; white-space: pre-wrap; word-break: break-word; }
.lc-focus-empty { margin: 14px auto 0; max-width: 520px; font-size: 13px; line-height: 1.9;
  color: #9c968b; }
.lc-focus-ops { position: absolute; top: 10px; right: 12px; display: flex; gap: 6px;
  opacity: .35; transition: opacity .12s; }
.lc-focus:hover .lc-focus-ops { opacity: 1; }
.lc-focus-rule { width: 24px; height: 2px; border-radius: 2px; background: #e2c39a;
  margin: 9px auto 0; }
.lc-sum { display: flex; gap: 14px; border-top: 1px solid #f4f2ee; padding: 11px 2px; }
.lc-sum:first-child { border-top: 0; }
.lc-sum-when { width: 78px; flex: none; font-size: 10.5px; color: #a8a49c; padding-top: 2px;
  font-variant-numeric: tabular-nums; }
.lc-sum-main { flex: 1; min-width: 0; font-size: 12px; line-height: 1.8; color: #35342e;
  white-space: pre-wrap; word-break: break-word; }
.lc-sum .lc-ops { flex: none; opacity: .4; transition: opacity .1s; }
.lc-sum:hover .lc-ops { opacity: 1; }
`

		function ensureStyle() {
			if (typeof document === 'undefined' || !document) return
			if (document.querySelector('style[data-plugin="' + PACKAGE_ID + '"]')) return
			const el = document.createElement('style')
			el.setAttribute('data-plugin', PACKAGE_ID)
			el.textContent = CSS
			document.head.appendChild(el)
		}

		/* ────────────────────────── 小部件 ────────────────────────── */
		function PanelIcon(props) {
			const size = (props && props.size) || 18
			const active = !!(props && props.active)
			const dots = []
			for (let i = 0; i < 16; i++) {
				const col = i % 4
				const row = Math.floor(i / 4)
				const lit = i < 11
				dots.push(h('rect', {
					key: i,
					x: 1.5 + col * 3.6,
					y: 1.5 + row * 3.6,
					width: 3,
					height: 3,
					rx: 0.8,
					fill: lit ? 'currentColor' : 'none',
					stroke: lit ? 'none' : 'currentColor',
					strokeWidth: 0.7,
					opacity: lit ? (active ? 0.95 : 0.75) : 0.35,
				}))
			}
			return h('svg', {
				width: size, height: size, viewBox: '0 0 18 18',
				role: 'img', 'aria-label': PANEL_LABEL,
			}, dots, h('rect', { key: 'now', x: 12.3, y: 12.3, width: 3.4, height: 3.4, rx: 0.9, fill: '#b45309' }))
		}

		function Field(props) {
			const cls = props && props.className ? 'lc-frow ' + props.className : 'lc-frow'
			return h('div', { className: cls }, props.children)
		}

		/* ────────────────────────── 事件表单 ────────────────────────── */
		function EventForm({ initial, onCancel, onSubmit }) {
			const [date, setDate] = useState(initial.date || ymd(today()))
			const [title, setTitle] = useState(initial.title || '')
			const [kind, setKind] = useState(initial.kind || 'milestone')
			const [star, setStar] = useState(initial.star !== false)
			const [note, setNote] = useState(initial.note || '')
			const [err, setErr] = useState(null)
			const [busy, setBusy] = useState(false)
			const titleRef = useRef(null)

			useEffect(() => { try { titleRef.current && titleRef.current.focus() } catch (e) { /* ignore */ } }, [])

			const submit = useCallback(async () => {
				if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { setErr('先选日期'); return }
				if (!title.trim()) { setErr('标题不能为空'); return }
				setBusy(true)
				setErr(null)
				try {
					await onSubmit({ id: initial.id, date, title: title.trim(), kind, star, note: note.trim() })
				} catch (e) {
					setErr(String((e && e.message) || e))
				} finally {
					setBusy(false)
				}
			}, [date, title, kind, star, note, initial.id, onSubmit])

			return h('div', { className: 'lc-form', onKeyDown: (e) => {
				if (e.key === 'Escape') onCancel()
				if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
			} },
				h(Field, null,
					h('input', { type: 'date', value: date, onChange: (e) => setDate(e.target.value) }),
					h('input', { type: 'text', ref: titleRef, placeholder: '发生了什么？', value: title,
						maxLength: 120, onChange: (e) => setTitle(e.target.value) }),
					h('select', { value: kind, onChange: (e) => setKind(e.target.value) },
						KINDS.map((k) => h('option', { key: k[0], value: k[0] }, k[1]))),
					h('label', { className: 'lc-check' },
						h('input', { type: 'checkbox', checked: star, onChange: (e) => setStar(e.target.checked) }),
						'标为重点')),
				h('textarea', { placeholder: '为什么值得记住（可留空）', value: note, maxLength: 2000,
					onChange: (e) => setNote(e.target.value) }),
				err ? h('div', { className: 'lc-form-err' }, err) : null,
				h(Field, null,
					h('button', { className: 'lc-btn primary', onClick: submit, disabled: busy },
						busy ? '保存中…' : (initial.id ? '保存修改' : '记下')),
					h('button', { className: 'lc-btn', onClick: onCancel, disabled: busy }, '取消'),
					h('span', { style: { marginLeft: 'auto', fontSize: '10.5px', color: '#a3a09a' } },
						'⌘/Ctrl + Enter 保存 · Esc 取消')))
		}

		/** 阶段表单：名称 + 年份区间 + 一句标注。年份是绝对年，标完不用随生日重算。 */
		function StageForm({ initial, birthYear, lifeEnd, onCancel, onSubmit }) {
			const [name, setName] = useState(initial.name || '')
			const [from, setFrom] = useState(String(initial.from != null ? initial.from : birthYear))
			const [to, setTo] = useState(String(initial.to != null ? initial.to : Math.min(lifeEnd, birthYear + 17)))
			const [note, setNote] = useState(initial.note || '')
			const [err, setErr] = useState(null)
			const [busy, setBusy] = useState(false)
			const nameRef = useRef(null)

			useEffect(() => { try { nameRef.current && nameRef.current.focus() } catch (e) { /* ignore */ } }, [])

			const submit = useCallback(async () => {
				const f = Number(from)
				const t = Number(to)
				if (!Number.isInteger(f) || !Number.isInteger(t)) { setErr('起止年要填整数年，比如 1999'); return }
				if (t < f) { setErr('结束年不能早于起始年'); return }
				if (f < birthYear || t > lifeEnd) {
					setErr('要在 ' + birthYear + '–' + lifeEnd + ' 之间')
					return
				}
				setBusy(true)
				setErr(null)
				try {
					await onSubmit({ id: initial.id, name: name.trim(), from: f, to: t, note: note.trim() })
				} catch (e) {
					setErr(String((e && e.message) || e))
				} finally {
					setBusy(false)
				}
			}, [name, from, to, note, initial.id, onSubmit, birthYear, lifeEnd])

			return h('div', { className: 'lc-form', onKeyDown: (e) => {
				if (e.key === 'Escape') onCancel()
				if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
			} },
				h(Field, null,
					h('input', { type: 'text', ref: nameRef, placeholder: '这段叫什么？比如「求学」「立身」',
						value: name, maxLength: 24, onChange: (e) => setName(e.target.value) }),
					h('input', { type: 'text', inputMode: 'numeric', placeholder: '起年', value: from,
						style: { width: '72px', flex: 'none' }, onChange: (e) => setFrom(e.target.value.replace(/[^0-9]/g, '')) }),
					h('span', { style: { fontSize: '11.5px', color: '#8f8f87' } }, '—'),
					h('input', { type: 'text', inputMode: 'numeric', placeholder: '止年', value: to,
						style: { width: '72px', flex: 'none' }, onChange: (e) => setTo(e.target.value.replace(/[^0-9]/g, '')) }),
					h('span', { style: { fontSize: '11px', color: '#a3a09a' } }, '含首尾两年')),
				h('textarea', { placeholder: '这一段的标注（可留空）：你在做什么、放下什么', value: note,
					maxLength: 400, onChange: (e) => setNote(e.target.value) }),
				err ? h('div', { className: 'lc-form-err' }, err) : null,
				h(Field, null,
					h('button', { className: 'lc-btn primary', onClick: submit, disabled: busy },
						busy ? '保存中…' : (initial.id ? '保存修改' : '记下这一段')),
					h('button', { className: 'lc-btn', onClick: onCancel, disabled: busy }, '取消'),
					h('span', { style: { marginLeft: 'auto', fontSize: '10.5px', color: '#a3a09a' } },
						'⌘/Ctrl + Enter 保存 · Esc 取消')))
		}

		/* ────────────────────────── 主面板 ────────────────────────── */
		function Panel(props) {
			const ctx = props && props.__ctx
			const [doc, setDoc] = useState(null)
			const [loading, setLoading] = useState(true)
			const [error, setError] = useState(null)
			const [selYear, setSelYear] = useState(null)
			const [selMonth, setSelMonth] = useState(null)
			const [form, setForm] = useState(null)      // {id?, date, title, kind, star, note} | null
			const [confirmId, setConfirmId] = useState(null)
			const [allView, setAllView] = useState(false)
			const [kindFilter, setKindFilter] = useState(null)
			const [setup, setSetup] = useState(false)
			const [setupBirth, setSetupBirth] = useState('')
			const [setupYears, setSetupYears] = useState('80')
			const [selStage, setSelStage] = useState(null)     // 阶段 id
			const [stageForm, setStageForm] = useState(null)   // {id?, name, from, to, note} | null
			const [stageOpen, setStageOpen] = useState(true)
			const [mileOpen, setMileOpen] = useState(false)
			const [eventsOpen, setEventsOpen] = useState(true)
			const [strategyEdit, setStrategyEdit] = useState(false)
			const [strategyDraft, setStrategyDraft] = useState('')
			const [summaryForm, setSummaryForm] = useState(null)  // {id?, date, body} | null
			const [sumOpen, setSumOpen] = useState(true)
			const confirmTimer = useRef(null)

			const load = useCallback(async () => {
				setLoading(true)
				setError(null)
				try {
					const value = await callApi(ctx, { action: 'get' })
					setDoc(value)
				} catch (e) {
					setError(String((e && e.message) || e))
				} finally {
					setLoading(false)
				}
			}, [ctx])

			useEffect(() => { load() }, [load])
			useEffect(() => () => { if (confirmTimer.current) clearTimeout(confirmTimer.current) }, [])

			const profile = (doc && doc.profile) || {}
			const events = useMemo(() => (doc && doc.events) || [], [doc])
			const birth = useMemo(() => parseYmd(profile.birth), [profile.birth])
			const expectancy = Number(profile.expectancy) > 0 ? Number(profile.expectancy) : 80
			const now = today()
			const age = birth ? ageOn(birth, now) : null
			const birthYear = birth ? birth.getFullYear() : null
			const thisYear = now.getFullYear()

			const byYear = useMemo(() => {
				const m = {}
				events.forEach((e) => {
					const y = Number(String(e.date).slice(0, 4))
					if (!m[y]) m[y] = []
					m[y].push(e)
				})
				return m
			}, [events])

			const year = selYear == null ? thisYear : selYear
			const scopeEvents = useMemo(() => {
				const list = selMonth == null
					? (byYear[year] || [])
					: (byYear[year] || []).filter((e) => Number(String(e.date).slice(5, 7)) === selMonth)
				return list.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
			}, [byYear, year, selMonth])

			const monthCount = useMemo(() => {
				const arr = new Array(12).fill(0)
				const tops = new Array(12).fill(null)
				;(byYear[year] || []).forEach((e) => {
					const i = Number(String(e.date).slice(5, 7)) - 1
					if (i >= 0 && i < 12) {
						arr[i] += 1
						if (!tops[i]) tops[i] = e.title
					}
				})
				return { arr, tops }
			}, [byYear, year])

			const strategy = String((doc && doc.strategy) || '')
			const summaries = useMemo(() => ((doc && doc.summaries) || []), [doc])

			/* ◆ 是「重点」标记，不是类型 —— 类型仍由 kind 决定，两者别混着数。 */
			const stars = events.filter((e) => e.star).length
			const nextYear = useMemo(() => {
				const ys = Object.keys(byYear).map(Number).filter((y) => y >= thisYear).sort()
				return ys.length ? ys[0] : null
			}, [byYear, thisYear])

			/* 全部事件：按年倒序分组，年内正序 —— 最近的一年先看见，同一年里像流水一样读。 */
			const groupByYear = useCallback((list) => {
				const sorted = list.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
				const out = []
				let cur = null
				sorted.forEach((e) => {
					const y = Number(String(e.date).slice(0, 4))
					if (!cur || cur.year !== y) { cur = { year: y, items: [] }; out.push(cur) }
					cur.items.push(e)
				})
				out.forEach((g) => g.items.reverse())
				return out
			}, [])
			const allGroups = useMemo(() => groupByYear(events), [groupByYear, events])
			const shownGroups = useMemo(
				() => (kindFilter ? groupByYear(events.filter((e) => (e.kind || 'other') === kindFilter)) : allGroups),
				[groupByYear, allGroups, events, kindFilter])
			const kindCounts = useMemo(() => {
				const m = {}
				events.forEach((e) => { const k = e.kind || 'other'; m[k] = (m[k] || 0) + 1 })
				return m
			}, [events])
			const shownTotal = useMemo(
				() => (kindFilter ? events.filter((e) => (e.kind || 'other') === kindFilter).length : events.length),
				[events, kindFilter])

			/* ── 人生阶段：年份区间是数据，颜色是呈现 ── */
			const STAGE_COLORS = ['#b45309', '#2f6f5e', '#4b6a8f', '#8a6b3f', '#7b5ea7', '#9a5b5b', '#5c7a3f', '#a05a7a']
			const stages = useMemo(
				() => (doc && Array.isArray(doc.stages) ? doc.stages.slice().sort((a, b) => a.from - b.from) : []),
				[doc])
			const colorOf = useCallback((id) => {
				const i = stages.findIndex((x) => x.id === id)
				return STAGE_COLORS[(i < 0 ? 0 : i) % STAGE_COLORS.length]
			}, [stages])
			const lifeEnd = birthYear ? birthYear + expectancy - 1 : null
			const milestones = useMemo(
				() => events.filter((e) => e.kind === 'milestone')
					.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
				[events])
			const stage = selStage ? stages.find((x) => x.id === selStage) : null
			const stageEvents = useMemo(() => {
				if (!stage) return []
				const list = events.filter((e) => {
					const y = Number(String(e.date).slice(0, 4))
					return y >= stage.from && y <= stage.to
				})
				return list.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
			}, [events, stage])
			/* 阶段带：把「已划分」和「未划分」都铺满一生，缺口也看得见。 */
			const stageSegs = useMemo(() => {
				if (!birthYear) return []
				const start = birthYear
				const end = birthYear + expectancy - 1
				const out = []
				let cursor = start
				stages.forEach((x) => {
					const from = Math.max(start, x.from)
					const to = Math.min(end, x.to)
					if (to < from) return
					if (from > cursor) out.push({ key: 'gap' + cursor, gap: true, from: cursor, to: from - 1 })
					out.push({ key: x.id, gap: false, stage: x, from, to })
					cursor = Math.max(cursor, to + 1)
				})
				if (cursor <= end) out.push({ key: 'gap' + cursor, gap: true, from: cursor, to: end })
				return out
			}, [stages, birthYear, expectancy])

			/* ── 写操作 ── */
			const saveProfile = useCallback(async () => {
				try {
					const value = await callApi(ctx, { action: 'profile', birth: setupBirth, expectancy: Number(setupYears) || 80 })
					setDoc(value)
					setSetup(false)
					setError(null)
				} catch (e) { setError(String((e && e.message) || e)) }
			}, [ctx, setupBirth, setupYears])

			const saveEvent = useCallback(async (ev) => {
				const value = await callApi(ctx, { action: 'save', event: ev })
				setDoc(value)
				setForm(null)
				setError(null)
				/* 落在哪年哪月就跳到哪 —— 记完能立刻看见刚写的那一条，而不是被切走。 */
				setSelYear(Number(String(ev.date).slice(0, 4)))
				if (selMonth != null) setSelMonth(Number(String(ev.date).slice(5, 7)))
			}, [ctx, selYear])

			const removeEvent = useCallback(async (id) => {
				if (confirmId !== id) {
					setConfirmId(id)
					if (confirmTimer.current) clearTimeout(confirmTimer.current)
					confirmTimer.current = setTimeout(() => setConfirmId(null), 2600)
					return
				}
				if (confirmTimer.current) clearTimeout(confirmTimer.current)
				setConfirmId(null)
				try {
					const value = await callApi(ctx, { action: 'delete', id })
					setDoc(value)
					setError(null)
				} catch (e) { setError(String((e && e.message) || e)) }
			}, [ctx, confirmId])

			const saveStage = useCallback(async (st) => {
				const value = await callApi(ctx, { action: 'stage-save', stage: st })
				setDoc(value)
				setStageForm(null)
				setError(null)
			}, [ctx])

			const removeStage = useCallback(async (id) => {
				if (confirmId !== id) {
					setConfirmId(id)
					if (confirmTimer.current) clearTimeout(confirmTimer.current)
					confirmTimer.current = setTimeout(() => setConfirmId(null), 2600)
					return
				}
				if (confirmTimer.current) clearTimeout(confirmTimer.current)
				setConfirmId(null)
				try {
					const value = await callApi(ctx, { action: 'stage-delete', id })
					setDoc(value)
					if (selStage === id) setSelStage(null)
					setError(null)
				} catch (e) { setError(String((e && e.message) || e)) }
			}, [ctx, confirmId, selStage])

			/** 默认划分：只是把五种年龄段摆出来当起点，随时可改。 */
			const applyPreset = useCallback(async () => {
				const end = birthYear + expectancy - 1
				const defs = [['求学', 0, 17], ['立身', 18, 29], ['成家', 30, 44], ['深耕', 45, 59], ['余下', 60, expectancy - 1]]
					.map((d) => ({ name: d[0], from: birthYear + d[1], to: Math.min(end, birthYear + d[2]), note: '' }))
					.filter((d) => d.from <= end && d.to >= d.from)
				try {
					let value = doc
					for (const d of defs) {
						value = await callApi(ctx, { action: 'stage-save', stage: d })
					}
					setDoc(value)
					setError(null)
				} catch (e) { setError(String((e && e.message) || e)) }
			}, [ctx, birthYear, expectancy, doc])

			const startAdd = useCallback(() => {
				const base = selMonth != null
					? year + '-' + pad2(selMonth) + '-01'
					: (year === thisYear ? ymd(now) : year + '-01-01')
				setForm({ date: base, title: '', kind: 'other', star: false, note: '' })
			}, [selMonth, year, thisYear, now])

			/** 人生战略：只有一条，写清楚就算数。 */
			const saveStrategy = useCallback(async (text) => {
				try {
					const value = await callApi(ctx, { action: 'strategy-save', text })
					setDoc(value)
					setStrategyEdit(false)
					setError(null)
				} catch (e) { setError(String((e && e.message) || e)) }
			}, [ctx])

			const saveSummary = useCallback(async (item) => {
				try {
					const value = await callApi(ctx, { action: 'summary-save', summary: item })
					setDoc(value)
					setSummaryForm(null)
					setError(null)
				} catch (e) { setError(String((e && e.message) || e)) }
			}, [ctx])

			const removeSummary = useCallback(async (id) => {
				if (confirmId !== 'sum:' + id) {
					setConfirmId('sum:' + id)
					if (confirmTimer.current) clearTimeout(confirmTimer.current)
					confirmTimer.current = setTimeout(() => setConfirmId(null), 2600)
					return
				}
				if (confirmTimer.current) clearTimeout(confirmTimer.current)
				setConfirmId(null)
				try {
					const value = await callApi(ctx, { action: 'summary-delete', id })
					setDoc(value)
					setError(null)
				} catch (e) { setError(String((e && e.message) || e)) }
			}, [ctx, confirmId])

			/* ── 导出 ── */
			const download = useCallback((name, text, mime) => {
				try {
					const blob = new Blob([text], { type: mime + ';charset=utf-8' })
					const url = URL.createObjectURL(blob)
					const a = document.createElement('a')
					a.href = url
					a.download = name
					document.body.appendChild(a)
					a.click()
					a.remove()
					setTimeout(() => { try { URL.revokeObjectURL(url) } catch (e) { /* ignore */ } }, 1500)
				} catch (e) {
					setError('导出失败：' + String((e && e.message) || e))
				}
			}, [])

			/** 完整数据：能原样存回去，也是换机器时的搬家文件。 */
			const exportJson = useCallback(() => {
				if (!doc) return
				const payload = {
					version: doc.version || 1,
					exportedAt: new Date().toISOString(),
					profile: doc.profile || {},
					events: doc.events || [],
					stages: doc.stages || [],
					strategy: doc.strategy || '',
					summaries: doc.summaries || [],
				}
				download('life-calendar-' + ymd(now) + '.json', JSON.stringify(payload, null, 2), 'application/json')
			}, [doc, download, now])

			/** 给人读的：按年排下来，一条一行。 */
			const exportMarkdown = useCallback(() => {
				if (!doc) return
				const lines = ['# 人生日历', '']
				if (profile.birth) lines.push('- 生日：' + profile.birth + (age == null ? '' : '（' + age + ' 岁）'))
				lines.push('- 预期寿命：' + expectancy + ' 岁')
				lines.push('- 事件：' + events.length + ' 件' + (stars ? '，其中重点 ' + stars + ' 件' : ''))
				lines.push('- 导出于 ' + ymd(now))
				if (strategy) lines.push('', '## 人生战略', '', strategy)
				if (stages.length) {
					lines.push('', '## 人生阶段', '')
					stages.forEach((x) => {
						lines.push('- ' + x.name + '（' + x.from + '–' + x.to + '）'
							+ (x.note ? ' —— ' + String(x.note).replace(/\s*\n+\s*/g, ' ') : ''))
					})
				}
				allGroups.forEach((g) => {
					lines.push('', '## ' + g.year + '（' + g.items.length + ' 件）', '')
					g.items.forEach((e) => {
						const md = String(e.date).slice(5).replace('-', '/')
						lines.push('- ' + md + (e.star ? ' ◆' : '') + ' ' + e.title
							+ (e.note ? ' —— ' + String(e.note).replace(/\s*\n+\s*/g, ' ') : ''))
					})
				})
				if (summaries.length) {
					lines.push('', '## 重要总结', '')
					summaries.forEach((x) => {
						lines.push('- ' + x.date + '　' + String(x.body || '').replace(/\s*\n+\s*/g, ' '))
					})
				}
				download('life-calendar-' + ymd(now) + '.md', lines.join('\n') + '\n', 'text/markdown')
			}, [doc, profile.birth, age, expectancy, events.length, stars, allGroups, stages,
				strategy, summaries, download, now])

			/* ── 头部 ── */
			const head = h('div', { className: 'lc-head' },
				h('div', null,
					h('h1', null, '人生日历'),
					h('p', { className: 'lc-sub' },
						birth ? '一格一年 · ' + expectancy + ' 格 · 从这里往回看' : '一格一年 · 还没填生日')),
				h('div', { className: 'lc-head-right' },
					doc ? h('button', { className: 'lc-link', onClick: exportJson, title: '完整数据，可原样备份' }, '导出 .json') : null,
					doc ? h('button', { className: 'lc-link', onClick: exportMarkdown, title: '按年排列的纯文本' }, '导出 .md') : null,
					h('button', { className: 'lc-link', onClick: () => {
						setSetupBirth(profile.birth || '')
						setSetupYears(String(expectancy))
						setSetup(true)
					} }, '设置')))

			if (loading) {
				return h('div', { className: 'lc' }, h('div', { className: 'lc-inner' }, head,
					h('div', { className: 'lc-empty' }, '读取中…')))
			}

			const banner = error
				? h('div', { className: 'lc-banner' }, h('span', null, error),
					h('button', { className: 'lc-btn', onClick: load, style: { marginLeft: 'auto' } }, '重试'))
				: null

			/* ── 设置卡 ── */
			if (!birth || setup) {
				return h('div', { className: 'lc' }, h('div', { className: 'lc-inner' }, head, banner,
					h('div', { className: 'lc-setup' },
						h('h2', null, birth ? '改一下口径' : '先填一个生日'),
						h('p', null, birth
							? '改完格子会重排，已有事件不会丢。'
							: '格子要有个起点。生日只存在本机，不上传。'),
						h(Field, null,
							h('span', { style: { fontSize: '11.5px', color: '#6b6b64', width: '52px' } }, '生日'),
							h('input', { type: 'date', value: setupBirth,
								onChange: (e) => setSetupBirth(e.target.value), style: {
									font: 'inherit', fontSize: '12px', border: '1px solid #e2dfd8',
									borderRadius: '6px', padding: '5px 8px', background: '#fff' } }),
							h('span', { style: { fontSize: '11.5px', color: '#6b6b64' } }, '预期寿命'),
							h('input', { type: 'number', min: 1, max: 120, value: setupYears,
								onChange: (e) => setSetupYears(e.target.value), style: {
									width: '62px', font: 'inherit', fontSize: '12px', border: '1px solid #e2dfd8',
									borderRadius: '6px', padding: '5px 8px', background: '#fff' } }),
							h('span', { style: { fontSize: '11.5px', color: '#8f8f87' } }, '岁')),
						h(Field, { className: 'lc-frow top' },
							h('button', { className: 'lc-btn primary', onClick: saveProfile }, '保存'),
							birth ? h('button', { className: 'lc-btn', onClick: () => setSetup(false) }, '取消') : null))))
			}

			/* ── 一生格 ── */
			const cols = 10
			const rows = Math.ceil(expectancy / cols)
			const rowEls = []
			for (let r = 0; r < rows; r++) {
				const cells = []
				for (let c = 0; c < cols; c++) {
					const i = r * cols + c
					if (i >= expectancy) { cells.push(h('span', { key: 'x' + i, className: 'lc-cell', style: { visibility: 'hidden' } })); continue }
					const y = birthYear + i
					const n = (byYear[y] || []).length
					const cls = ['lc-cell']
					if (y === thisYear) cls.push('current')
					else if (y < thisYear) cls.push('past')
					else cls.push('future')
					if (y === year) cls.push('sel')
					const alpha = Math.min(0.9, 0.3 + n * 0.2)
					cells.push(h('button', {
						key: 'c' + i,
						className: cls.join(' '),
						title: y + ' · ' + i + ' 岁 · ' + (n ? n + ' 件事' : '空着'),
						style: n ? { background: 'rgba(180,83,9,' + alpha.toFixed(2) + ')', borderColor: 'transparent' } : null,
						onClick: () => { setSelYear(y); setSelMonth(null); setAllView(false); setSelStage(null) },
					}))
				}
				rowEls.push(h('div', { key: 'r' + r, className: 'lc-row' },
					h('span', { className: 'lc-age' }, r * cols), cells))
			}

			const left = Math.max(0, expectancy - (age == null ? 0 : age))
			const motto = (function () {
				if (!events.length) return '先记下一件已经发生的事 —— 格子有了重量，才像一生。'
				if (left <= 0) return '格子用完了。往后每一年，都是多出来的。'
				if (left <= 10) return '还剩 ' + left + ' 格。够做一件真正想做的事，不够做很多件。'
				if (age != null && age <= 25) return '前面很密，后面还空 —— 空的地方正好放以后。'
				return '还剩 ' + left + ' 格。已经写下的 ' + events.length + ' 件不会消失，这是唯一确定的事。'
			})()

			const lifeBlock = h('section', { className: 'lc-life' },
				h('div', { className: 'lc-hero' },
					h('div', { className: 'lc-rows' }, rowEls),
					h('div', { className: 'lc-hero-side' },
						h('div', { className: 'lc-figs' },
							birth ? h('div', { className: 'lc-fig' }, h('b', null, age), '岁') : null,
							birth ? h('div', { className: 'lc-fig warm' },
								h('b', null, Math.max(0, expectancy - age)), '格待填') : null,
							h('div', { className: 'lc-fig' }, h('b', null, events.length), '件事'),
							stars ? h('div', { className: 'lc-fig' }, h('b', null, stars), '件重点') : null),
						h('p', { className: 'lc-motto' }, motto),
						h('div', { className: 'lc-legend' },
							h('span', null, h('i', { style: { background: '#e2ded5' } }), '已走过'),
							h('span', null, h('i', { style: { background: '#fff', border: '1.5px solid #b45309' } }), '今年'),
							h('span', null, h('i', { style: { background: '#fff', border: '1px dashed #e6e2da' } }), '待填'),
							h('span', null, h('i', { style: { background: 'rgba(180,83,9,.55)' } }), '有事件 · 越深越多'),
							h('span', null, '今年已过 ' + Math.round(yearProgress(now) * 100) + '% · 剩 '
								+ daysLeftThisYear(now) + ' 天')))))

			const firstGap = stageSegs.find((x) => x.gap) || null
			const openNewStage = (gapFrom, gapTo) => {
				const f = gapFrom != null ? gapFrom : (firstGap ? firstGap.from : birthYear)
				const rawTo = gapTo != null ? gapTo : (firstGap ? firstGap.to : lifeEnd)
				setStageForm({ name: '', from: f, to: Math.min(rawTo, f + 17, lifeEnd), note: '' })
			}

			/* ── 人生阶段：一条带子看清分段，一列条目看见标注 ── */
			const stageBlock = h('section', { className: 'lc-stagesec' },
				h('div', { className: 'lc-sec-head lc-fold' + (stageOpen ? ' open' : ''),
					onClick: () => setStageOpen(!stageOpen) },
					h('h2', null, h('span', { className: 'lc-caret' }, '▶'), '人生阶段'),
					h('span', { className: 'dim' }, stages.length
						? stages.length + ' 段' + (stageSegs.some((x) => x.gap) ? ' · 还有未划分' : '')
						: '还没划分'),
					h('div', { className: 'right' },
						!stages.length ? h('button', { className: 'lc-btn ghost',
							onClick: (ev) => { ev.stopPropagation(); applyPreset() } }, '按默认划分') : null,
						h('button', { className: 'lc-btn ghost',
							onClick: (ev) => { ev.stopPropagation(); setStageOpen(!stageOpen) } },
							stageOpen ? '收起' : '展开'),
						h('button', { className: 'lc-btn primary',
							onClick: (ev) => { ev.stopPropagation(); openNewStage(null, null) } }, '＋ 划分阶段'))),
				stageForm ? h(StageForm, {
					initial: stageForm,
					birthYear,
					lifeEnd,
					onCancel: () => setStageForm(null),
					onSubmit: saveStage,
				}) : null,
				h('div', { className: 'lc-bandwrap' },
					stageSegs.length ? h('div', { className: 'lc-band' }, stageSegs.map((seg) => {
						const pct = (seg.to - seg.from + 1) / expectancy * 100
						const wide = pct >= 11
						if (seg.gap) {
							return h('button', {
								key: seg.key,
								className: 'lc-seg gap',
								style: { flex: '0 0 ' + pct.toFixed(3) + '%' },
								title: seg.from + '–' + seg.to + ' · 未划分，点这里补一段',
								onClick: () => openNewStage(seg.from, seg.to),
							}, h('b', null, wide ? '未划分' : '·'), wide ? h('span', null, seg.from + '–' + seg.to) : null)
						}
						const on = selStage === seg.stage.id
						return h('button', {
							key: seg.key,
							className: 'lc-seg' + (on ? ' on' : ''),
							style: {
								flex: '0 0 ' + pct.toFixed(3) + '%',
								background: colorOf(seg.stage.id),
								opacity: seg.from > thisYear ? 0.45 : 1,
							},
							title: seg.stage.name + ' · ' + seg.from + '–' + seg.to + (seg.stage.note ? '\n' + seg.stage.note : ''),
							onClick: () => {
								setSelStage(on ? null : seg.stage.id)
								setAllView(false)
								setSelMonth(null)
								setKindFilter(null)
								setSelYear(seg.from)
							},
						}, h('b', null, seg.stage.name), wide ? h('span', null, seg.from + '–' + seg.to) : null)
					})) : null,
					h('div', { className: 'lc-runner' },
						h('span', null, birthYear + ' · 0 岁'),
						h('span', null, lifeEnd + ' · ' + (expectancy - 1) + ' 岁'))),
				stageOpen && stages.length ? h('div', null, stages.map((x, i) => h('div', {
					key: x.id,
					className: 'lc-stagerow' + (selStage === x.id ? ' on' : ''),
					onClick: () => {
						setSelStage(selStage === x.id ? null : x.id)
						setAllView(false)
						setSelMonth(null)
						setKindFilter(null)
						setSelYear(x.from)
					},
				},
					h('i', { className: 'lc-sdot', style: { background: colorOf(x.id) } }),
					h('b', { className: 'lc-sname' }, x.name),
					h('span', { className: 'lc-srange' },
						x.from + '–' + x.to + ' · ' + (x.from - birthYear) + '–' + (x.to - birthYear) + ' 岁'),
					x.note ? h('span', { className: 'lc-snote' }, x.note) : null,
					h('div', { className: 'lc-ops' },
						h('button', { className: 'lc-btn ghost', onClick: (ev) => {
							ev.stopPropagation()
							setStageForm({ id: x.id, name: x.name, from: x.from, to: x.to, note: x.note })
						} }, '改'),
						h('button', {
							className: 'lc-btn ghost' + (confirmId === x.id ? ' danger' : ''),
							onClick: (ev) => { ev.stopPropagation(); removeStage(x.id) },
						}, confirmId === x.id ? '确认删' : '删'))))) : null)

			/* ── 人生里程碑：你亲手标了 ◆ 的那些事，按年份摊开 ── */
			const milestoneBlock = h('section', { className: 'lc-mile' },
				h('div', { className: 'lc-sec-head lc-fold' + (mileOpen ? ' open' : ''),
					onClick: () => setMileOpen(!mileOpen) },
					h('h2', null, h('span', { className: 'lc-caret' }, '▶'), '人生里程碑'),
					h('span', { className: 'dim' }, milestones.length
						? milestones.length + ' 件' + (mileOpen ? '' : ' · 最近 ' + String(milestones[milestones.length - 1].date).slice(0, 7).replace('-', '/'))
						: '还没有'), 
					h('div', { className: 'right' },
						h('button', { className: 'lc-btn ghost',
							onClick: (ev) => { ev.stopPropagation(); setMileOpen(!mileOpen) } },
							mileOpen ? '收起' : '展开'))),
				mileOpen ? (milestones.length
					? h('div', { className: 'lc-mslist' }, milestones.map((e) => {
						const y = Number(String(e.date).slice(0, 4))
						const m = Number(String(e.date).slice(5, 7))
						return h('div', {
							key: e.id,
							className: 'lc-ms',
							onClick: () => {
								setSelYear(y); setSelMonth(m)
								setAllView(false); setSelStage(null); setKindFilter(null)
							},
						},
							h('span', { className: 'lc-ms-when' }, y + ' · ' + (y - birthYear) + ' 岁'),
							h('div', { className: 'lc-ms-main' },
								h('b', null, e.title),
								e.note ? h('div', { className: 'lc-ev-note' }, e.note) : null),
							h('span', { className: 'lc-tag' }, KIND_LABEL[e.kind] || e.kind || '其他'))
					}))
					: h('div', { className: 'lc-empty' }, '还没有「里程碑」类型的事件。记一件时把类型选成里程碑，它就会排到这里。'))
					: null)

			/* ── 年 / 月 ── */
			const monthCells = []
			for (let m = 1; m <= 12; m++) {
				const n = monthCount.arr[m - 1]
				monthCells.push(h('button', {
					key: 'm' + m,
					className: 'lc-month' + (n ? ' has' : ' empty') + (selMonth === m ? ' sel' : ''),
					onClick: () => { setSelMonth(selMonth === m ? null : m); setAllView(false); setSelStage(null) },
				},
					h('div', { className: 'lc-mtop' }, h('b', null, m + ' 月'),
						h('span', null, n ? n + ' 件' : '—')),
					h('div', { className: 'lc-mtitle' }, n ? monthCount.tops[m - 1] : '空着')))
			}

			const yearBlock = h('section', null,
				h('div', { className: 'lc-sec-head' },
					h('h2', null, year),
					h('span', { className: 'dim' }, birth ? '· ' + Math.max(0, year - birthYear) + ' 岁' : ''),
					h('div', { className: 'right' },
						h('span', { className: 'dim' }, (byYear[year] || []).length + ' 件'),
						h('button', { className: 'lc-nav', title: '上一年',
							onClick: () => { setSelYear(Math.max(birthYear, year - 1)); setSelMonth(null); setSelStage(null) } }, '‹'),
						h('button', { className: 'lc-nav', title: '下一年',
							onClick: () => { setSelYear(Math.min(birthYear + expectancy - 1, year + 1)); setSelMonth(null); setSelStage(null) } }, '›'),
						h('button', { className: 'lc-btn', onClick: () => { setSelYear(thisYear); setSelMonth(null); setSelStage(null) } }, '今年'))),
				h('div', { className: 'lc-months' }, monthCells))

			/* ── 事件列表 ── */
			const listTitle = selMonth == null
				? (year + ' 年')
				: (year + ' 年 ' + selMonth + ' 月')

			const eventRow = (e, dateText) => h('div', { key: e.id, className: 'lc-ev' },
				h('span', { className: 'lc-ev-date' }, dateText),
				h('span', { className: 'lc-star' }, e.star ? '◆' : ''),
				h('div', { className: 'lc-ev-main' },
					h('b', null, e.title),
					e.note ? h('span', { className: 'lc-ev-note' }, e.note) : null),
				h('span', { className: 'lc-tag' }, KIND_LABEL[e.kind] || e.kind || '其他'),
				h('div', { className: 'lc-ops' },
					h('button', { className: 'lc-btn ghost', onClick: () => setForm({
						id: e.id, date: e.date, title: e.title, kind: e.kind, star: e.star, note: e.note }) }, '改'),
					h('button', { className: 'lc-btn ghost' + (confirmId === e.id ? ' danger' : ''),
						onClick: () => removeEvent(e.id) }, confirmId === e.id ? '确认删' : '删')))

			const scopeRows = scopeEvents.map((e) => {
				const d = String(e.date)
				return eventRow(e, selMonth == null ? d.slice(5).replace('-', '/') : d.slice(8) + ' 日')
			})

			const allBlock = h('div', { className: 'lc-list' }, shownGroups.map((g) => h('div', {
				key: 'g' + g.year, className: 'lc-g' },
				h('div', { className: 'lc-ghead' },
					h('button', { className: 'lc-gyear', title: '只看这一年',
						onClick: () => {
							setSelYear(g.year); setSelMonth(null); setAllView(false); setKindFilter(null); setSelStage(null)
						} }, g.year + ' 年'),
					h('span', { className: 'dim' }, g.items.length + ' 件')),
				g.items.map((e) => eventRow(e, String(e.date).slice(5).replace('-', '/'))))))

			const kindFilters = h('div', { className: 'lc-filters' },
				h('button', {
					className: 'lc-chip' + (kindFilter == null ? ' on' : ''),
					onClick: () => setKindFilter(null),
				}, '全部', h('i', null, events.length)),
				KINDS.filter((k) => kindCounts[k[0]] > 0).map((k) => h('button', {
					key: k[0],
					className: 'lc-chip' + (kindFilter === k[0] ? ' on' : ''),
					onClick: () => setKindFilter(kindFilter === k[0] ? null : k[0]),
				}, k[1], h('i', null, kindCounts[k[0]]))))

			const shownCount = stage ? stageEvents.length : (allView ? shownTotal : scopeEvents.length)
			const emptyText = allView
				? (kindFilter && events.length ? '这一类还没有记录。' : '还没有记录。')
				: (selMonth != null
					? (year + ' 年 ' + selMonth + ' 月还没有记录。')
					: (year + ' 年还没有记录。'))

			const eventsBlock = h('section', { className: 'lc-events' },
				h('div', { className: 'lc-sec-head lc-fold' + (eventsOpen ? ' open' : ''),
					onClick: () => setEventsOpen(!eventsOpen) },
					h('h2', null, h('span', { className: 'lc-caret' }, '▶'),
						stage ? stage.name : (allView ? '全部事件' : listTitle)),
					h('span', { className: 'dim' }, stage
						? stage.from + '–' + stage.to + ' · ' + shownCount + ' 件'
						: (shownCount + ' 件' + (allView && kindFilter && events.length ? ' · 共 ' + events.length + ' 件' : ''))),
					h('div', { className: 'right' },
						h('button', { className: 'lc-btn ghost',
							onClick: (ev) => { ev.stopPropagation(); setEventsOpen(!eventsOpen) } },
							eventsOpen ? '收起' : '展开'),
						stage
							? h('button', { className: 'lc-btn ghost',
								onClick: (ev) => { ev.stopPropagation(); setSelStage(null) } }, '按年看')
							: (allView
								? h('button', { className: 'lc-btn ghost',
									onClick: (ev) => { ev.stopPropagation(); setAllView(false); setKindFilter(null) } }, '按年看')
								: h('button', { className: 'lc-btn ghost',
									onClick: (ev) => { ev.stopPropagation(); setAllView(true); setForm(null) } }, '全部事件')),
						(!stage && !allView && selMonth != null)
							? h('button', { className: 'lc-btn ghost',
								onClick: (ev) => { ev.stopPropagation(); setSelMonth(null) } }, '看全年')
							: null,
						h('button', { className: 'lc-btn primary',
							onClick: (ev) => { ev.stopPropagation(); startAdd() } }, '＋ 记一件'))),
				eventsOpen ? (allView && !stage ? kindFilters : null) : null,
				eventsOpen && form ? h(EventForm, {
					initial: form,
					onCancel: () => setForm(null),
					onSubmit: saveEvent,
				}) : null,
				eventsOpen ? (stage
					? (stageEvents.length
						? h('div', { className: 'lc-list' }, stageEvents.map((e) => eventRow(e, String(e.date).slice(2).replace(/-/g, '/'))))
						: h('div', { className: 'lc-empty' }, '这一段还没有记录。'))
					: (allView
						? (shownGroups.length
							? allBlock
							: h('div', { className: 'lc-empty' }, emptyText + ' 空着不等于没发生。'))
						: (scopeRows.length
							? h('div', { className: 'lc-list' }, scopeRows)
							: h('div', { className: 'lc-empty' }, emptyText + '　空着不等于没发生。')))) : null)

			/* ── 人生战略：整页只有一个，用聚焦卡呈现 ── */
			const strategyBlock = strategyEdit
				? h('section', { className: 'lc-strategy' },
					h('div', { className: 'lc-card' },
						h('div', { className: 'lc-frow' },
							h('span', { className: 'lc-flabel' }, '人生战略'),
							h('textarea', {
								className: 'lc-ta',
								rows: 5,
								value: strategyDraft,
								placeholder: '我要什么、不要什么、愿意为此付什么代价。三句话以内。',
								onChange: (e) => setStrategyDraft(e.target.value),
							})),
						h('div', { className: 'lc-frow top' },
							h('button', { className: 'lc-btn primary',
								onClick: () => saveStrategy(strategyDraft) }, '存下'),
							h('button', { className: 'lc-btn ghost',
								onClick: () => setStrategyEdit(false) }, '取消'),
							h('span', { className: 'lc-hint' }, '随时可改。写下的是判据，不是誓言。'))))
				: h('section', { className: 'lc-strategy' },
					h('div', { className: 'lc-focus' },
						h('div', { className: 'lc-focus-ops' },
							h('button', { className: 'lc-btn ghost', onClick: () => {
								setStrategyDraft(strategy)
								setStrategyEdit(true)
							} }, strategy ? '改' : '写一条')),
						h('div', { className: 'lc-focus-label' }, '人生战略'),
						h('div', { className: 'lc-focus-rule' }),
						strategy
							? h('div', { className: 'lc-focus-body' }, strategy)
							: h('div', { className: 'lc-focus-empty' },
								'还没写。写下你要什么、不要什么、愿意付什么代价 —— 以后每次犹豫，先看这一句。')))

			/* ── 重要总结：只有时间和内容，可增可改可删，可折叠 ── */
			const summaryBlock = h('section', { className: 'lc-sumsec' },
				h('div', {
					className: 'lc-sec-head lc-fold' + (sumOpen ? ' open' : ''),
					onClick: () => setSumOpen(!sumOpen),
				},
					h('h2', null, h('span', { className: 'lc-caret' }, '▶'), '重要总结'),
					h('span', { className: 'dim' }, summaries.length ? summaries.length + ' 条' : '还没有'),
					h('div', { className: 'right' },
						h('button', {
							className: 'lc-btn ghost',
							onClick: (ev) => { ev.stopPropagation(); setSumOpen(!sumOpen) },
						}, sumOpen ? '收起' : '展开'),
						h('button', {
							className: 'lc-btn ghost',
							onClick: (ev) => {
								ev.stopPropagation()
								setSummaryForm({ date: ymd(now), body: '' })
								setSumOpen(true)
							},
						}, '＋ 写一条'))),
				sumOpen
					? (summaryForm
						? h('div', { className: 'lc-card' },
							h('div', { className: 'lc-frow' },
								h('span', { className: 'lc-flabel' }, '日期'),
								h('input', {
									type: 'date',
									value: summaryForm.date,
									onChange: (e) => setSummaryForm({ ...summaryForm, date: e.target.value }),
								})),
							h('div', { className: 'lc-frow' },
								h('textarea', {
									className: 'lc-ta',
									rows: 4,
									value: summaryForm.body,
									placeholder: '写下来还成立的那一句。为什么成立、什么时候不成立。',
									onChange: (e) => setSummaryForm({ ...summaryForm, body: e.target.value }),
								})),
							h('div', { className: 'lc-frow top' },
								h('button', { className: 'lc-btn primary', onClick: () => saveSummary(summaryForm) },
									summaryForm.id ? '存下这条' : '记下'),
								h('button', { className: 'lc-btn ghost', onClick: () => setSummaryForm(null) }, '取消')))
						: (summaries.length
							? h('div', null, summaries.map((x) => h('div', { key: x.id, className: 'lc-sum' },
								h('div', { className: 'lc-sum-when' }, x.date),
								h('div', { className: 'lc-sum-main' }, x.body),
								h('div', { className: 'lc-ops' },
									h('button', { className: 'lc-btn ghost',
										onClick: () => setSummaryForm({ id: x.id, date: x.date, body: x.body }) }, '改'),
									h('button', {
										className: 'lc-btn ghost' + (confirmId === 'sum:' + x.id ? ' danger' : ''),
										onClick: () => removeSummary(x.id),
									}, confirmId === 'sum:' + x.id ? '确认删' : '删')))))
							: h('div', { className: 'lc-empty' }, '还没有总结。每条能救你一次的东西，都值得记下来。')))
					: null)

			return h('div', { className: 'lc' }, h('div', { className: 'lc-inner' },
				head, banner, stageBlock, milestoneBlock, lifeBlock, yearBlock, eventsBlock,
				strategyBlock, summaryBlock))
		}

		const inject = ['connection', 'slots']

		function registerInto(ctx, slotName, options, component) {
			const slots = ctx && ctx.slots
			if (!slots || typeof slots.register !== 'function') return
			const install = () => slots.register(options, component)
			if (typeof slots.inject === 'function') {
				slots.inject(slotName, install)
				return
			}
			try {
				install()
			} catch (e) {
				setTimeout(() => { try { install() } catch (_) { /* ignore */ } }, 0)
			}
		}

		function apply(ctx) {
			ensureStyle()
			if (ctx && typeof ctx.effect === 'function') {
				ctx.effect(() => () => {
					if (typeof document === 'undefined' || !document) return
					try {
						const els = document.querySelectorAll('style[data-plugin="' + PACKAGE_ID + '"]')
						for (let i = 0; i < els.length; i++) els[i].remove()
					} catch (e) { /* ignore */ }
				}, PACKAGE_ID + ' CSS ownership')
			}

			registerInto(ctx, 'sidebar.panellist',
				{ name: 'sidebar.panellist', id: PANEL_ID, order: 30, label: PANEL_LABEL },
				PanelIcon)

			registerInto(ctx, 'main',
				{ name: 'main', key: PANEL_ID },
				(props) => h(Panel, Object.assign({}, props, { __ctx: ctx })))
		}

		return { name: PACKAGE_ID, apply, inject }
	},
})
