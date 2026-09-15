import { Capacitor, CapacitorHttp } from '@capacitor/core'
import './style.css'
import heroLogoUrl from './assets/frepro.png'

const MIN = 0
const MAX = 140
const DOLLARS_PER_UNIT = 1000

const app = document.querySelector('#app')
if (!app) {
	throw new Error('Missing #app element')
}

const desktop = null
const isDesktopApp = false
const isNativeApp = typeof Capacitor?.isNativePlatform === 'function' && Capacitor.isNativePlatform()

const DEFAULT_API_BASE_URL = 'https://1wos40ydh1.execute-api.us-east-2.amazonaws.com'
const API_BASE_URL = (import.meta?.env?.VITE_API_BASE_URL || '').trim() || (import.meta.env.DEV ? '/api' : DEFAULT_API_BASE_URL)
const WEB_SESSION_KEY = 'freedom-program:web-session:v1'

/** @type {null | { id: number, name?: string, email: string, token?: string, cloudUserId?: string, role?: string, assignedInstructorEmail?: string }} */

let session = null
let authMode = 'login'
let habitBoardState = { items: [] }
let profileSettings = {
	name: '',
	email: '',
	contactInfo: '',
	goalStartDate: '',
	goalEndDate: '',
	goodAt: '',
	enjoys: '',
	strengths: '',
	weaknesses: '',
}
let ledgerEntryMetaByClientId = {}
let savingsLogEntries = []
let customSavingsCategories = []
let customExpenseCategories = []
let customIncomeCategories = []
let weeklyReports = []
let journalEntries = []
let freedomJournalEntries = []
let weeklyThought = 'Deep satisfaction is the natural and proper fruit of a job well done.'
const WEEKLY_THOUGHT_STORAGE_KEY = 'freedom-program:weekly-thought:v1'

try {
	const savedWeeklyThought = String(localStorage.getItem(WEEKLY_THOUGHT_STORAGE_KEY) || '').trim()
	if (savedWeeklyThought) weeklyThought = savedWeeklyThought.slice(0, 600)
} catch {
	// Keep the default thought when storage is unavailable.
}
let dailyReportWeekMs = startOfLocalWeekMs(new Date())
let dailyReportDayIndex = getCurrentWeekdayIndex(new Date())
let selectedFavoritesTab = ''
let accountNotifications = []
let instructorStudentEmails = []
let selectedInstructorStudentEmail = ''
let selectedInstructorRosterEmail = ''
let financeDetailFocus = 'income'
let entrySavingsAllocationDraft = {}
let editingLedgerClientId = ''
let reviewEntryDateFilter = ''
let incomeAllocationDraft = {}
let expenseAllocationDraft = {}
let collapsibleUiState = {}
let instructorDashboardState = {
	role: 'student',
	instructors: [],
	students: [],
	allStudents: [],
}

const WEEKLY_REPORT_STORAGE_PREFIX = 'freedom-program:weekly-reports:v1:'
const JOURNAL_STORAGE_PREFIX = 'freedom-program:journals:v1:'
const FREEDOM_JOURNAL_STORAGE_PREFIX = 'freedom-program:freedom-journal:v1:'
const INSTRUCTOR_CHECKIN_STORAGE_PREFIX = 'freedom-program:instructor-check-ins:v1:'
const DAY_MS = 24 * 60 * 60 * 1000
const JOURNAL_STAR_KEYS = ['financial', 'jobs', 'lessons', 'meaningfulWork']
const WEEKLY_STAR_KEYS = ['meetings', 'books', 'lessons', 'finances']

function escapeHtml(value) {
	return String(value || '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;')
}

function formatHabitText(value) {
	const safe = escapeHtml(value).trim()
	if (!safe) return '<span class="habit-empty">No entry yet.</span>'
	return safe.replace(/\n/g, '<br />')
}

function truncateText(value, maxLength = 90) {
	const safe = String(value || '').trim().replace(/\s+/g, ' ')
	if (!safe) return ''
	return safe.length > maxLength ? `${safe.slice(0, maxLength - 1)}...` : safe
}

function normalizeAccountRole(value) {
	return value === 'instructor' || value === 'super-instructor' ? value : 'student'
}

function normalizeAccountEmail(value) {
	return String(value || '').trim().toLowerCase()
}

function normalizeNotificationItems(items) {
	if (!Array.isArray(items)) return []
	return items
		.map((item) => ({
			id: String(item?.id || '').trim(),
			message: String(item?.message || '').trim(),
			senderEmail: normalizeAccountEmail(item?.senderEmail),
			createdAtMs: Number(item?.createdAtMs) || 0,
		}))
		.filter((item) => item.id && item.message)
		.sort((a, b) => b.createdAtMs - a.createdAtMs)
		.slice(0, 25)
}

function normalizeCheckInStatus(value) {
	const status = String(value || '').trim().toLowerCase()
	if (status === 'on-track' || status === 'needs-support' || status === 'at-risk') return status
	return 'needs-support'
}

function normalizeInstructorCheckIn(value = {}) {
	return {
		status: normalizeCheckInStatus(value?.status),
		focus: sanitizeShortText(value?.focus || '', 180),
		progress: sanitizeLongText(value?.progress || '', 800),
		blockers: sanitizeLongText(value?.blockers || '', 800),
		support: sanitizeLongText(value?.support || '', 800),
		updatedAtMs: Number(value?.updatedAtMs) || 0,
	}
}

function loadInstructorCheckIns() {
	return loadScopedJson(INSTRUCTOR_CHECKIN_STORAGE_PREFIX, {})
}

function getInstructorCheckIn(studentEmail) {
	const key = normalizeAccountEmail(studentEmail)
	if (!key) return normalizeInstructorCheckIn()
	const all = loadInstructorCheckIns()
	return normalizeInstructorCheckIn(all?.[key])
}

function saveInstructorCheckIn(studentEmail, nextValue) {
	const key = normalizeAccountEmail(studentEmail)
	if (!key) return
	const all = loadInstructorCheckIns()
	all[key] = normalizeInstructorCheckIn({ ...nextValue, updatedAtMs: Date.now() })
	saveScopedJson(INSTRUCTOR_CHECKIN_STORAGE_PREFIX, all)
}

function getStudentCoachStatus(student) {
	const email = normalizeAccountEmail(student?.email)
	const goalDollars = Math.max(0, Number(student?.goal?.goalDollars) || 0)
	const currentSavingsDollars = Math.max(0, Number(student?.goal?.currentSavingsDollars) || 0)
	const completionPct = goalDollars > 0 ? Math.round((currentSavingsDollars / goalDollars) * 100) : 0
	const weeklyReportCount = Math.max(0, Number(student?.reports?.weeklyReportCount) || 0)
	const monthlyJournalCount = Math.max(0, Number(student?.reports?.monthlyJournalCount) || 0)
	const habitChecks = Math.max(0, Number(student?.habitBoard?.completedChecks) || 0)
	const checkIn = getInstructorCheckIn(email)
	const reasons = []

	if (completionPct < 40) reasons.push('Low goal progress')
	if (weeklyReportCount < 1) reasons.push('No recent weekly report')
	if (monthlyJournalCount < 1) reasons.push('No recent monthly journal')
	if (habitChecks < 1) reasons.push('No habit check activity')
	if (checkIn.status === 'at-risk') reasons.push('Student marked at risk')
	if (checkIn.status === 'needs-support') reasons.push('Student requested support')

	if (checkIn.status === 'at-risk' || completionPct < 35 || weeklyReportCount === 0 || monthlyJournalCount === 0) {
		return { status: 'at-risk', reasons: reasons.length ? reasons : ['Needs immediate follow-up'] }
	}
	if (checkIn.status === 'needs-support' || completionPct < 70 || weeklyReportCount < 2 || habitChecks < 2) {
		return { status: 'needs-support', reasons: reasons.length ? reasons : ['Needs coaching support'] }
	}
	return { status: 'on-track', reasons: ['Steady progress'] }
}

function summarizeInstructorRoster(students) {
	const summary = { atRisk: 0, needsSupport: 0, onTrack: 0 }
	for (const student of Array.isArray(students) ? students : []) {
		const status = getStudentCoachStatus(student).status
		if (status === 'at-risk') summary.atRisk += 1
		else if (status === 'needs-support') summary.needsSupport += 1
		else summary.onTrack += 1
	}
	return summary
}

function escapeCsvCell(value) {
	return `"${String(value ?? '').replace(/"/g, '""')}"`
}

function exportInstructorRosterCsv() {
	const students = Array.isArray(instructorDashboardState.students) ? instructorDashboardState.students : []
	const rows = [
		['Student name', 'Email', 'Goal', 'Saved', 'Completion %', 'Risk status', 'Monthly prep status', 'Last update'],
	]
	for (const student of students) {
		const email = normalizeAccountEmail(student?.email)
		const goalDollars = Math.max(0, Number(student?.goal?.goalDollars) || 0)
		const currentSavingsDollars = Math.max(0, Number(student?.goal?.currentSavingsDollars) || 0)
		const completionPct = goalDollars > 0 ? Math.round((currentSavingsDollars / goalDollars) * 100) : 0
		const checkIn = getInstructorCheckIn(email)
		rows.push([
			student?.name || student?.email || 'Student',
			email,
			goalDollars,
			currentSavingsDollars,
			completionPct,
			getStudentCoachStatus(student).status,
			checkIn.status,
			checkIn.updatedAtMs ? formatDateLabel(checkIn.updatedAtMs) : 'No prep saved',
		])
	}
	const csvText = rows.map((row) => row.map((cell) => escapeCsvCell(cell)).join(',')).join('\n')
	const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' })
	const url = URL.createObjectURL(blob)
	const link = document.createElement('a')
	link.href = url
	link.download = 'instructor-roster.csv'
	link.click()
	URL.revokeObjectURL(url)
}

function isInstructorSession(currentSession = session) {
	const role = normalizeAccountRole(currentSession?.role)
	return role === 'instructor' || role === 'super-instructor'
}

function isSuperInstructorSession(currentSession = session) {
	return normalizeAccountRole(currentSession?.role) === 'super-instructor'
}

function applyAccountSnapshot(snapshot) {
	accountNotifications = normalizeNotificationItems(snapshot?.notifications)
	instructorStudentEmails = Array.isArray(snapshot?.studentEmails)
		? [...new Set(snapshot.studentEmails.map((email) => normalizeAccountEmail(email)).filter(Boolean))]
		: []
	if (!session) return
	session = {
		...session,
		role: normalizeAccountRole(snapshot?.role),
		assignedInstructorEmail: normalizeAccountEmail(snapshot?.assignedInstructorEmail) || undefined,
	}
	saveWebSessionToStorage(session)
	renderAccountNotifications()
}

function toMonthInputValue(value) {
	const ms = parseDateInputToDayMs(value)
	const d = new Date(startOfLocalMonthMs(new Date(ms)))
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function getCurrentMonthIso() {
	return isoDateValue(startOfLocalMonthMs(new Date()))
}

function getCurrentWeekIso() {
	return isoDateValue(startOfLocalWeekMs(new Date()))
}

function parseMonthInputToIso(value) {
	const raw = String(value || '').trim()
	if (!raw) return isoDateValue(startOfLocalMonthMs(new Date()))
	const [y, m] = raw.split('-').map((part) => Number(part))
	if (!Number.isFinite(y) || !Number.isFinite(m)) return isoDateValue(startOfLocalMonthMs(new Date()))
	return isoDateValue(startOfLocalMonthMs(new Date(y, m - 1, 1)))
}

function formatMonthHeading(value) {
	const ms = parseDateInputToDayMs(value)
	return new Date(ms).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

function getCurrentWeekdayIndex(date = new Date()) {
	return (new Date(date).getDay() + 6) % 7
}

function getPrimaryHabitBox(state = sanitizeHabitBoardState(habitBoardState)) {
	return state?.boxes?.[0] || createEmptyHabitBox(0)
}

function getHabitSquareItems(state = sanitizeHabitBoardState(habitBoardState)) {
	return getPrimaryHabitBox(state).items || []
}

function hasHabitBoardSquares(state = sanitizeHabitBoardState(habitBoardState)) {
	return getHabitSquareItems(state).length > 0
}

function createHabitChecksArray(count = getHabitSquareItems().length, source = []) {
	const safeCount = Math.max(0, Number(count) || 0)
	const checks = Array.isArray(source) ? source.slice(0, safeCount).map(Boolean) : []
	while (checks.length < safeCount) checks.push(false)
	return checks
}

function createEmptyDailyWeek(checkCount = getHabitSquareItems().length) {
	return {
		days: new Array(7).fill(null).map(() => ({
			did: '',
			didWell: '',
			couldDoBetter: '',
			checks: createHabitChecksArray(checkCount),
			isStarred: false,
			starredNote: '',
		})),
	}
}

function getDailyWeekKey(ms = dailyReportWeekMs) {
	return isoDateValue(startOfLocalWeekMs(new Date(ms)))
}

function getDefaultDailyFocusIndex(weekMs = dailyReportWeekMs) {
	const safeWeekMs = startOfLocalWeekMs(new Date(weekMs))
	const currentWeekMs = startOfLocalWeekMs(new Date())
	return safeWeekMs === currentWeekMs ? getCurrentWeekdayIndex(new Date()) : 0
}

function setDailyReportWeek(weekMs) {
	dailyReportWeekMs = startOfLocalWeekMs(new Date(weekMs))
	dailyReportDayIndex = getDefaultDailyFocusIndex(dailyReportWeekMs)
}

function createEmptyStarredSections(keys) {
	return Object.fromEntries(keys.map((key) => [key, { active: false, note: '' }]))
}

function sanitizeStarredSections(value, keys) {
	const base = createEmptyStarredSections(keys)
	for (const key of keys) {
		base[key] = {
			active: Boolean(value?.[key]?.active),
			note: sanitizeLongText(value?.[key]?.note || '', 180),
		}
	}
	return base
}

function hasActiveStarredSections(starredSections) {
	return Object.values(starredSections || {}).some((section) => Boolean(section?.active))
}

function countActiveStarredSections(starredSections) {
	return Object.values(starredSections || {}).filter((section) => Boolean(section?.active)).length
}

function readStarredSection(buttonId) {
	return {
		active: Boolean(document.getElementById(buttonId)?.classList.contains('star-toggle--active')),
		note: '',
	}
}

function bindStarToggleButtons(root) {
	root?.querySelectorAll?.('[data-star-toggle]')?.forEach((node) => {
		node.addEventListener('click', (event) => {
			event.preventDefault()
			const button = /** @type {HTMLButtonElement} */ (event.currentTarget)
			const next = !button.classList.contains('star-toggle--active')
			button.classList.toggle('star-toggle--active', next)
			button.textContent = next ? (button.dataset.activeLabel || 'Favorited') : (button.dataset.inactiveLabel || 'Favorite')
		})
	})
}

function formatFavoriteCount(count) {
	return `${count} ${count === 1 ? 'favorite' : 'favorites'}`
}

function getFavoriteCollections() {
	/** @type {Array<{ id: string, title: string, description: string, items: Array<{ category: string, label: string, summary: string, sortValue: string }> }>} */
	const collections = []
	const journalItems = []
	for (const entry of journalEntries) {
		if (entry.starredSections?.financial?.active) journalItems.push({ category: 'Financial', label: formatMonthHeading(entry.month), summary: entry.goalThisMonth || entry.financialProgress || entry.aheadBehind || 'No journal summary yet.', sortValue: entry.month })
		if (entry.starredSections?.jobs?.active) journalItems.push({ category: 'Jobs Held', label: formatMonthHeading(entry.month), summary: [entry.primaryJob, entry.secondaryJob, entry.volunteerOpportunities].filter(Boolean).join('\n') || 'No jobs summary yet.', sortValue: entry.month })
		if (entry.starredSections?.lessons?.active) journalItems.push({ category: 'Lessons Learned', label: formatMonthHeading(entry.month), summary: [entry.reading, entry.meetings, entry.classes].filter(Boolean).join('\n') || 'No lessons summary yet.', sortValue: entry.month })
		if (entry.starredSections?.meaningfulWork?.active) journalItems.push({ category: 'Meaningful Work', label: formatMonthHeading(entry.month), summary: [entry.billingJob, entry.interests, entry.enjoying, entry.helpPeople].filter(Boolean).join('\n') || 'No meaningful work summary yet.', sortValue: entry.month })
	}
	if (journalItems.length) {
		collections.push({
			id: 'monthly-report',
			title: 'Monthly Report',
			description: 'Monthly report favorites grouped by section.',
			items: journalItems.sort((a, b) => b.sortValue.localeCompare(a.sortValue) || a.category.localeCompare(b.category)),
		})
	}
	const freedomJournalItems = freedomJournalEntries
		.filter((entry) => entry.isFavorite)
		.map((entry) => ({
			category: entry.freedomFive,
			label: entry.title || formatDateLabel(entry.createdAtMs),
			summary: entry.reflection || 'No reflection saved yet.',
			sortValue: isoDateValue(entry.createdAtMs),
		}))
	if (freedomJournalItems.length) {
		collections.push({
			id: 'personal-journal',
			title: 'Journal',
			description: 'Saved Freedom FIVES and other journal reflections.',
			items: freedomJournalItems.sort((a, b) => b.sortValue.localeCompare(a.sortValue)),
		})
	}
	const weeklyItems = []
	for (const entry of weeklyReports) {
		if (entry.starredSections?.meetings?.active) weeklyItems.push({ category: 'Meeting', label: `Week of ${formatDateLabel(entry.week)}`, summary: [entry.meetingWho1 && `Who: ${entry.meetingWho1}`, entry.meetingLearned1, entry.meetingWho2 && `Who: ${entry.meetingWho2}`, entry.meetingLearned2].filter(Boolean).join('\n') || 'No meeting summary yet.', sortValue: entry.week })
		if (entry.starredSections?.books?.active) weeklyItems.push({ category: 'Books', label: `Week of ${formatDateLabel(entry.week)}`, summary: [entry.book1 && `${entry.book1} (${entry.book1Chapter})`, entry.book1Learned, entry.book2 && `${entry.book2} (${entry.book2Chapter})`, entry.book2Learned].filter(Boolean).join('\n') || 'No books summary yet.', sortValue: entry.week })
		if (entry.starredSections?.lessons?.active) weeklyItems.push({ category: 'Lessons', label: `Week of ${formatDateLabel(entry.week)}`, summary: [entry.lessonTitle1 && `${entry.lessonTitle1}: ${entry.lessonLearned1}`, entry.lessonTitle2 && `${entry.lessonTitle2}: ${entry.lessonLearned2}`].filter(Boolean).join('\n') || 'No lesson summary yet.', sortValue: entry.week })
		if (entry.starredSections?.finances?.active) weeklyItems.push({ category: 'Finances', label: `Week of ${formatDateLabel(entry.week)}`, summary: `Income ${formatDollars(entry.incomeJob1 + entry.incomeJob2)} · Expenses ${formatDollars(entry.expenses)} · Margin ${formatSignedDollars(entry.incomeJob1 + entry.incomeJob2 - entry.expenses)}`, sortValue: entry.week })
	}
	if (weeklyItems.length) {
		collections.push({
			id: 'weekly',
			title: 'Weekly Report',
			description: 'Weekly favorites grouped by report section.',
			items: weeklyItems.sort((a, b) => b.sortValue.localeCompare(a.sortValue) || a.category.localeCompare(b.category)),
		})
	}
	const safeBoard = sanitizeHabitBoardState(habitBoardState)
	const habitSquares = getHabitSquareItems(safeBoard)
	const habitItems = []
	for (const [weekKey, weekValue] of Object.entries(safeBoard.weeksByKey || {})) {
		weekValue.days.forEach((day, index) => {
			if (!day.isStarred) return
			const dayMs = startOfLocalWeekMs(new Date(weekKey)) + index * DAY_MS
			const completedHabits = habitSquares
				.filter((item, itemIndex) => Boolean(day.checks?.[itemIndex]))
				.map((item, itemIndex) => item.title || `Habit ${itemIndex + 1}`)
			const summaryParts = [
				day.did ? `Did: ${day.did}` : '',
				day.didWell ? `Did Well: ${day.didWell}` : '',
				day.couldDoBetter ? `Could Do Better: ${day.couldDoBetter}` : '',
				completedHabits.length ? `Completed Habits: ${completedHabits.join(', ')}` : 'Completed Habits: None',
			].filter(Boolean)
			habitItems.push({ category: 'Daily Entries', label: formatDateLabel(dayMs), summary: summaryParts.join('\n'), sortValue: isoDateValue(dayMs) })
		})
	}
	if (habitItems.length) {
		collections.push({
			id: 'habits',
			title: 'Habits',
			description: 'Daily favorites grouped from the habit tracker.',
			items: habitItems.sort((a, b) => b.sortValue.localeCompare(a.sortValue) || a.category.localeCompare(b.category)),
		})
	}
	return collections
}

function getRendererAppStateSnapshot() {
	return {
		profileSettings,
		habitBoardState,
		weeklyReports,
		journalEntries,
		freedomJournalEntries,
		ledgerEntryMetaByClientId,
		customSavingsCategories,
		customExpenseCategories,
		customIncomeCategories,
		savingsLogEntries,
		collapsibleUiState,
	}
}

async function cloudGetRendererState({ token }) {
	return apiJson({ method: 'GET', apiPath: '/profile/renderer-state', token })
}

async function cloudSetRendererState({ token, value }) {
	return apiJson({ method: 'POST', apiPath: '/profile/renderer-state', token, body: { value } })
}

let rendererStatePersistTimer = null
let rendererStatePersistInFlight = false

function applyRendererAppStateSnapshot(snapshot) {
	if (!snapshot || typeof snapshot !== 'object') return false

	const nextProfileSettings = sanitizeProfileSettings({
		...(snapshot.profileSettings || {}),
		goalStartDate: profileSettings.goalStartDate,
		goalEndDate: profileSettings.goalEndDate,
	})
	const nextHabitBoardState = sanitizeHabitBoardState(snapshot.habitBoardState)
	const nextWeeklyReports = (Array.isArray(snapshot.weeklyReports) ? snapshot.weeklyReports : [])
		.map(sanitizeWeeklyReportEntry)
		.sort((a, b) => b.week.localeCompare(a.week))
	const nextJournalEntries = (Array.isArray(snapshot.journalEntries) ? snapshot.journalEntries : [])
		.map(sanitizeJournalEntry)
		.sort((a, b) => b.month.localeCompare(a.month))
	const nextFreedomJournalEntries = (Array.isArray(snapshot.freedomJournalEntries) ? snapshot.freedomJournalEntries : [])
		.map(sanitizeFreedomJournalEntry)
		.sort((a, b) => b.createdAtMs - a.createdAtMs)
	const nextLedgerEntryMetaByClientId = Object.fromEntries(
		Object.entries(snapshot.ledgerEntryMetaByClientId || {}).map(([clientId, entryMeta]) => [clientId, sanitizeLedgerEntryMeta(entryMeta)])
	)
	const nextCustomSavingsCategories = sanitizeSavingsCategoryList(snapshot.customSavingsCategories)
	const nextCustomExpenseCategories = sanitizeExpenseCategoryList(snapshot.customExpenseCategories)
	const nextCustomIncomeCategories = sanitizeIncomeCategoryList(snapshot.customIncomeCategories)
	const nextSavingsLogEntries = (Array.isArray(snapshot.savingsLogEntries) ? snapshot.savingsLogEntries : [])
		.map((entry) => ({ month: Number(entry?.month), dollars: Math.max(0, Math.round(Number(entry?.dollars) || 0)) }))
		.filter((entry) => Number.isFinite(entry.month) && entry.month > 0)
		.sort((a, b) => a.month - b.month)
	const nextCollapsibleUiState = sanitizeCollapsibleUiState(snapshot.collapsibleUiState)

	profileSettings = nextProfileSettings
	habitBoardState = nextHabitBoardState
	weeklyReports = nextWeeklyReports
	journalEntries = nextJournalEntries
	freedomJournalEntries = nextFreedomJournalEntries
	ledgerEntryMetaByClientId = nextLedgerEntryMetaByClientId
	customSavingsCategories = nextCustomSavingsCategories
	customExpenseCategories = nextCustomExpenseCategories
	customIncomeCategories = nextCustomIncomeCategories
	savingsLogEntries = nextSavingsLogEntries
	collapsibleUiState = nextCollapsibleUiState

	saveScopedJson(PROFILE_SETTINGS_STORAGE_PREFIX, profileSettings)
	saveScopedJson(HABIT_BOARD_STORAGE_PREFIX, habitBoardState)
	saveScopedJson(WEEKLY_REPORT_STORAGE_PREFIX, weeklyReports)
	saveScopedJson(JOURNAL_STORAGE_PREFIX, journalEntries)
	saveScopedJson(FREEDOM_JOURNAL_STORAGE_PREFIX, freedomJournalEntries)
	saveScopedJson(LEDGER_META_STORAGE_PREFIX, ledgerEntryMetaByClientId)
	saveScopedJson(SAVINGS_CATEGORY_STORAGE_PREFIX, customSavingsCategories)
	saveScopedJson(EXPENSE_CATEGORY_STORAGE_PREFIX, customExpenseCategories)
	saveScopedJson(INCOME_CATEGORY_STORAGE_PREFIX, customIncomeCategories)
	saveScopedJson(SAVINGS_LOG_STORAGE_PREFIX, savingsLogEntries)
	saveScopedJson(COLLAPSIBLE_UI_STORAGE_PREFIX, collapsibleUiState)
	return true
}

async function flushRendererStatePersistence() {
	if (!session || rendererStatePersistInFlight) return
	rendererStatePersistInFlight = true
	try {
		if (isDesktopApp) {
			if (!desktop?.appState?.setRendererState) return
			await desktop.appState.setRendererState(getRendererAppStateSnapshot())
			return
		}
		if (!session?.token) return
		await cloudSetRendererState({ token: session.token, value: getRendererAppStateSnapshot() })
	} catch {
		// ignore persistence failures for now
	} finally {
		rendererStatePersistInFlight = false
	}
}

function persistDesktopRendererState() {
	if (!session) return
	if (rendererStatePersistTimer) clearTimeout(rendererStatePersistTimer)
	const delayMs = isDesktopApp ? 0 : 600
	rendererStatePersistTimer = setTimeout(() => {
		rendererStatePersistTimer = null
		void flushRendererStatePersistence()
	}, delayMs)
}

async function hydrateRendererStateFromCloud() {
	if (!session?.token || isDesktopApp) return false
	try {
		const out = await cloudGetRendererState({ token: session.token })
		return applyRendererAppStateSnapshot(out?.value)
	} catch {
		return false
	}
}

function formatWeekRangeLabel(weekMs) {
	const safeWeekMs = startOfLocalWeekMs(new Date(weekMs))
	return `${formatShortDate(safeWeekMs)} - ${formatShortDate(safeWeekMs + (6 * DAY_MS))}`
}

function getDailyWeekState(weekKey = getDailyWeekKey()) {
	const safeState = sanitizeHabitBoardState(habitBoardState)
	const checkCount = getHabitSquareItems(safeState).length || 4
	return safeState.weeksByKey[weekKey] || createEmptyDailyWeek(checkCount)
}

function setDailyWeekState(weekKey, weekState) {
	const nextState = sanitizeHabitBoardState(habitBoardState)
	const checkCount = getHabitSquareItems(nextState).length || 4
	nextState.weeksByKey[weekKey] = createEmptyDailyWeek(checkCount)
	for (let index = 0; index < 7; index += 1) {
		const day = weekState?.days?.[index] || {}
		const checks = createHabitChecksArray(checkCount, day?.checks)
		nextState.weeksByKey[weekKey].days[index] = {
			did: sanitizeLongText(day?.did || '', 240),
			didWell: sanitizeLongText(day?.didWell || '', 240),
			couldDoBetter: sanitizeLongText(day?.couldDoBetter || '', 240),
			checks,
			isStarred: Boolean(day?.isStarred),
			starredNote: '',
		}
	}
	saveHabitBoardToStorage(nextState)
}

function createSectionIntroMarkup(title, description, accentLabel = '') {
	return `<div class="report-section-intro"><div><h4>${escapeHtml(title)}</h4><p>${escapeHtml(description)}</p></div>${accentLabel ? `<div class="report-date-pill report-date-pill--subtle">${escapeHtml(accentLabel)}</div>` : ''}</div>`
}

function prependSectionIntro(container, title, description, accentLabel = '') {
	if (!container || container.querySelector('.report-section-intro')) return
	container.insertAdjacentHTML('afterbegin', createSectionIntroMarkup(title, description, accentLabel))
}

function enhanceJournalFormLayout(form, latest) {
	if (!form) return
	const blockGroups = Array.from(form.querySelectorAll('.report-columns'))
	blockGroups.forEach((group) => group.classList.add('report-columns--staggered'))
	const firstBlock = form.querySelector('.report-block')
	if (!firstBlock) return

	for (const intro of Array.from(form.querySelectorAll('.report-section-intro'))) {
		intro.remove()
	}

	firstBlock.insertAdjacentHTML('beforebegin', createSectionIntroMarkup('Monthly snapshot', 'Start with your money picture, then move into work, lessons, and life direction.', formatMonthHeading(latest.month)))
}

function enhanceWeeklyReportLayout(form, latest) {
	if (!form) return
	prependSectionIntro(form, 'Conversations and reading', 'Capture people, books, and key takeaways first, then finish with lessons and your weekly money snapshot.', `Week of ${formatDateLabel(latest.week)}`)
	const blockGroups = Array.from(form.querySelectorAll('.report-columns'))
	blockGroups.forEach((group) => group.classList.add('report-columns--staggered'))
	const weeklyThoughtCard = /** @type {HTMLDivElement | null} */ (form.querySelector('.report-quote'))
	const firstContentBlock = /** @type {HTMLDivElement | null} */ (form.querySelector('.report-block'))
	const firstIntro = /** @type {HTMLDivElement | null} */ (form.querySelector('.report-section-intro'))
	if (weeklyThoughtCard && firstContentBlock) {
		if (firstIntro) firstIntro.insertAdjacentElement('afterend', weeklyThoughtCard)
		else firstContentBlock.insertAdjacentElement('beforebegin', weeklyThoughtCard)
	}
	const financeBlock = document.getElementById('weeklyStarFinances')?.closest('.report-block')
	if (financeBlock) {
		financeBlock.querySelector('.report-fields--financial')?.classList.add('report-fields--weekly-financial')
		if (!financeBlock.querySelector('.report-section-subgrid')) {
			const financeFields = financeBlock.querySelector('.report-fields--financial')
			const marginNode = financeFields?.querySelector('.report-margin')
			const labels = financeFields ? Array.from(financeFields.querySelectorAll('.auth-label')) : []
			if (financeFields && labels.length) {
				const grid = document.createElement('div')
				grid.className = 'report-section-subgrid report-section-subgrid--three'
				labels.forEach((label) => grid.appendChild(label))
				financeFields.insertBefore(grid, marginNode || null)
			}
		}
	}
}

function getCollapsibleState(key, defaultExpanded = true) {
	if (!key) return Boolean(defaultExpanded)
	if (Object.prototype.hasOwnProperty.call(collapsibleUiState, key)) {
		return Boolean(collapsibleUiState[key])
	}
	return Boolean(defaultExpanded)
}

function setCollapsibleState(key, expanded) {
	if (!key) return
	collapsibleUiState[key] = Boolean(expanded)
	saveScopedJson(COLLAPSIBLE_UI_STORAGE_PREFIX, collapsibleUiState)
	void persistDesktopRendererState()
}

function applyCollapsibleSection(section, {
	key,
	header,
	defaultExpanded = true,
} = {}) {
	if (!section || !header) return
	let body = /** @type {HTMLDivElement | null} */ (section.querySelector(':scope > .section-collapsible-body'))
	if (!body) {
		body = document.createElement('div')
		body.className = 'section-collapsible-body'
		const bodyNodes = Array.from(section.children).filter((node) => node !== header)
		for (const node of bodyNodes) body.appendChild(node)
		section.appendChild(body)
	}
	let toggleBtn = /** @type {HTMLButtonElement | null} */ (header.querySelector('[data-collapse-toggle]'))
	if (!toggleBtn) {
		toggleBtn = document.createElement('button')
		toggleBtn.type = 'button'
		toggleBtn.className = 'section-collapse-arrow'
		toggleBtn.dataset.collapseToggle = 'true'
		toggleBtn.innerHTML = '<span aria-hidden="true">▸</span>'
		header.appendChild(toggleBtn)
	}
	const syncUi = (expanded) => {
		if (!body || !toggleBtn) return
		body.hidden = !expanded
		section.classList.toggle('is-collapsed', !expanded)
		toggleBtn.classList.toggle('is-expanded', expanded)
		toggleBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false')
		toggleBtn.setAttribute('aria-label', expanded ? 'Collapse section' : 'Expand section')
	}
	let expanded = getCollapsibleState(key, defaultExpanded)
	syncUi(expanded)
	toggleBtn.addEventListener('click', () => {
		expanded = !expanded
		setCollapsibleState(key, expanded)
		syncUi(expanded)
	})
}

function applyReportFormCollapsibleSections(form, pageKey) {
	if (!form) return
	const blocks = Array.from(form.querySelectorAll('.report-block'))
	blocks.forEach((block, index) => {
		const section = /** @type {HTMLDivElement} */ (block)
		const header = /** @type {HTMLDivElement | null} */ (section.querySelector(':scope > .report-block-head'))
		if (!header) return
		applyCollapsibleSection(section, {
			key: `${pageKey}-block-${index}`,
			header,
			defaultExpanded: false,
		})
	})
}

function applySettingsFormCollapsibleSections(form) {
	if (!form) return
	const sections = Array.from(form.querySelectorAll('.settings-section-card'))
	sections.forEach((card, index) => {
		const section = /** @type {HTMLDivElement} */ (card)
		const header = /** @type {HTMLDivElement | null} */ (section.querySelector(':scope > .settings-section-head'))
		if (!header) return
		applyCollapsibleSection(section, {
			key: `settings-section-${index}`,
			header,
			defaultExpanded: false,
		})
	})
}

function applyArchiveListCollapsible(listNode, key, defaultExpanded = false) {
	if (!listNode) return
	const title = /** @type {HTMLHeadingElement | null} */ (listNode.querySelector(':scope > .habit-list-title'))
	const list = /** @type {HTMLUListElement | null} */ (listNode.querySelector(':scope > ul'))
	if (!title || !list) return
	let head = /** @type {HTMLDivElement | null} */ (listNode.querySelector(':scope > .section-collapsible-head'))
	if (!head) {
		head = document.createElement('div')
		head.className = 'section-collapsible-head'
		title.replaceWith(head)
		head.appendChild(title)
	}
	applyCollapsibleSection(/** @type {HTMLDivElement} */ (listNode), {
		key,
		header: head,
		defaultExpanded,
	})
}

function insertReportQuoteCard(container, quoteLines = []) {
	if (!container || !Array.isArray(quoteLines) || !quoteLines.length) return
	const reportHeader = /** @type {HTMLDivElement | null} */ (container.querySelector('.report-header'))
	if (!reportHeader) return
	let quoteCard = /** @type {HTMLDivElement | null} */ (container.querySelector('.report-quote-card'))
	if (!quoteCard) {
		quoteCard = document.createElement('div')
		quoteCard.className = 'report-quote-card'
		reportHeader.insertAdjacentElement('afterend', quoteCard)
	}
	quoteCard.innerHTML = quoteLines.map((line) => `<p>${escapeHtml(line)}</p>`).join('')
}

function renderHabitTracker() {
    const wrap = document.getElementById('habitTrackerWrap')
	if (!wrap) return
	if (!session) {
		wrap.innerHTML = '<div class="habit-gate">Log in to use your journal.</div>'
		return
	}
	const latest = getCurrentJournalEntry()
	let html = `<div class="report-shell">
		<div class="report-header report-header--journal">
			<div>
				<div class="habit-kicker">Monthly Report</div>
				<h3 class="report-title">Freedom Program: Monthly Report</h3>
				<p class="habit-copy">Use the monthly page from the book to track financial progress, jobs held, lessons learned, and your pursuit of meaningful life work.</p>
			</div>
			<div class="report-date-pill">${escapeHtml(formatMonthHeading(latest.month))}</div>
		</div>
		<form id="journalForm" class="habit-form report-form">
			<div class="report-block report-block--full">
				<div class="report-block-head"><div class="report-block-title">Financial</div><button type="button" id="journalStarFinancial" data-star-toggle data-inactive-label="Favorite financial" data-active-label="Favorited" class="star-toggle star-toggle--compact ${latest.starredSections?.financial?.active ? 'star-toggle--active' : ''}">${latest.starredSections?.financial?.active ? 'Favorited' : 'Favorite financial'}</button></div>
				<div class="habit-fields report-fields report-fields--financial report-fields--journal-financial">
					<div class="report-financial-row">
						<div class="report-stamp"><span>Month</span><strong>${escapeHtml(formatMonthHeading(latest.month))}</strong></div>
						<label class="auth-label">
							<span>Own</span>
							<input type="number" id="journalOwn" class="auth-input" min="0" step="1" value="${latest.own}" />
						</label>
						<label class="auth-label">
							<span>Owe</span>
							<input type="number" id="journalOwe" class="auth-input" min="0" step="1" value="${latest.owe}" />
						</label>
					</div>
					<div class="auth-actions"><button type="button" class="auth-btn auth-btn--secondary" id="updateMonthlyFinancialSnapshot">Update Own from Financial</button></div>
					<label class="auth-label auth-label--wide">
						<span>My progress this month</span>
						<textarea id="journalFinancialProgress" class="auth-input habit-textarea" rows="2">${escapeHtml(latest.financialProgress)}</textarea>
					</label>
					<label class="auth-label">
						<span>I am ahead or behind</span>
						<input id="journalAheadBehind" class="auth-input" maxlength="60" value="${escapeHtml(latest.aheadBehind)}" />
					</label>
					<label class="auth-label auth-label--wide">
						<span>My goal this month</span>
						<textarea id="journalGoalThisMonth" class="auth-input habit-textarea" rows="2">${escapeHtml(latest.goalThisMonth)}</textarea>
					</label>
				</div>
			</div>
			<div class="report-columns">
				<div class="report-block">
					<div class="report-block-head"><div class="report-block-title">Jobs Held</div><button type="button" id="journalStarJobs" data-star-toggle data-inactive-label="Favorite jobs" data-active-label="Favorited" class="star-toggle star-toggle--compact ${latest.starredSections?.jobs?.active ? 'star-toggle--active' : ''}">${latest.starredSections?.jobs?.active ? 'Favorited' : 'Favorite jobs'}</button></div>
					<div class="habit-fields report-fields">
						<label class="auth-label auth-label--wide"><span>Primary job</span><input id="journalPrimaryJob" class="auth-input" maxlength="120" value="${escapeHtml(latest.primaryJob)}" /></label>
						<label class="auth-label auth-label--wide"><span>Secondary job</span><input id="journalSecondaryJob" class="auth-input" maxlength="120" value="${escapeHtml(latest.secondaryJob)}" /></label>
						<label class="auth-label auth-label--wide"><span>Volunteer opportunities</span><textarea id="journalVolunteerOpportunities" class="auth-input habit-textarea" rows="3">${escapeHtml(latest.volunteerOpportunities)}</textarea></label>
					</div>
				</div>
				<div class="report-block">
					<div class="report-block-head"><div class="report-block-title">Lessons Learned</div><button type="button" id="journalStarLessons" data-star-toggle data-inactive-label="Favorite lessons" data-active-label="Favorited" class="star-toggle star-toggle--compact ${latest.starredSections?.lessons?.active ? 'star-toggle--active' : ''}">${latest.starredSections?.lessons?.active ? 'Favorited' : 'Favorite lessons'}</button></div>
					<div class="habit-fields report-fields">
						<label class="auth-label auth-label--wide"><span>Reading</span><textarea id="journalReading" class="auth-input habit-textarea" rows="2">${escapeHtml(latest.reading)}</textarea></label>
						<label class="auth-label auth-label--wide"><span>Meetings</span><textarea id="journalMeetings" class="auth-input habit-textarea" rows="2">${escapeHtml(latest.meetings)}</textarea></label>
						<label class="auth-label auth-label--wide"><span>Classes or videos or podcasts</span><textarea id="journalClasses" class="auth-input habit-textarea" rows="2">${escapeHtml(latest.classes)}</textarea></label>
					</div>
				</div>
			</div>
			<div class="report-block report-block--full">
				<div class="report-block-head"><div class="report-block-title">My pursuit of meaningful life work</div><button type="button" id="journalStarMeaningfulWork" data-star-toggle data-inactive-label="Favorite life work" data-active-label="Favorited" class="star-toggle star-toggle--compact ${latest.starredSections?.meaningfulWork?.active ? 'star-toggle--active' : ''}">${latest.starredSections?.meaningfulWork?.active ? 'Favorited' : 'Favorite life work'}</button></div>
				<div class="habit-fields report-fields">
					<label class="auth-label auth-label--wide"><span>What job is paying the bills</span><textarea id="journalBillingJob" class="auth-input habit-textarea" rows="2">${escapeHtml(latest.billingJob)}</textarea></label>
					<label class="auth-label auth-label--wide"><span>What interests I've discovered</span><textarea id="journalInterests" class="auth-input habit-textarea" rows="2">${escapeHtml(latest.interests)}</textarea></label>
					<label class="auth-label auth-label--wide"><span>What I'm enjoying</span><textarea id="journalEnjoying" class="auth-input habit-textarea" rows="2">${escapeHtml(latest.enjoying)}</textarea></label>
					<label class="auth-label auth-label--wide"><span>How my interests could help people</span><textarea id="journalHelpPeople" class="auth-input habit-textarea" rows="2">${escapeHtml(latest.helpPeople)}</textarea></label>
				</div>
			</div>
			<div class="auth-actions">
				<button type="submit" class="auth-btn">Save Monthly Report</button>
			</div>
			<div id="journalError" class="auth-error" hidden></div>
		</form>`
	if (journalEntries.length > 0) {
		html += `<div class="habit-list"><h3 class="habit-list-title">Past Monthly Reports</h3><ul>${journalEntries.map((entry) => `<li class="habit-card"><div class="habit-card-head"><strong class="habit-card-week">${escapeHtml(formatMonthHeading(entry.month))}</strong><div class="habit-card-chip-row"><span class="habit-card-chip">Net worth ${formatSignedDollars(entry.own - entry.owe)}</span>${countActiveStarredSections(entry.starredSections) ? `<span class="habit-card-chip">${formatFavoriteCount(countActiveStarredSections(entry.starredSections))}</span>` : ''}</div></div><ul class="habit-card-grid"><li><span class="habit-card-label">Progress</span><div class="habit-card-text">${formatHabitText(entry.financialProgress)}</div></li><li><span class="habit-card-label">Goal this month</span><div class="habit-card-text">${formatHabitText(entry.goalThisMonth)}</div></li><li><span class="habit-card-label">Jobs held</span><div class="habit-card-text">${formatHabitText([entry.primaryJob, entry.secondaryJob].filter(Boolean).join('\n'))}</div></li><li><span class="habit-card-label">Meaningful life work</span><div class="habit-card-text">${formatHabitText(entry.billingJob)}</div></li></ul></li>`).join('')}</ul></div>`
	}
	html += '</div>'
	wrap.innerHTML = html
	const journalForm = document.getElementById('journalForm')
	enhanceJournalFormLayout(journalForm, latest)
	applyReportFormCollapsibleSections(journalForm, 'journal')
	const journalArchive = /** @type {HTMLDivElement | null} */ (wrap.querySelector('.habit-list'))
	applyArchiveListCollapsible(journalArchive, 'journal-history', false)
	const readJournalFormEntry = () => {
		const starredSections = {
			financial: readStarredSection('journalStarFinancial'),
			jobs: readStarredSection('journalStarJobs'),
			lessons: readStarredSection('journalStarLessons'),
			meaningfulWork: readStarredSection('journalStarMeaningfulWork'),
		}
		return sanitizeJournalEntry({
			month: getCurrentMonthIso(),
			own: document.getElementById('journalOwn')?.value,
			owe: document.getElementById('journalOwe')?.value,
			financialProgress: document.getElementById('journalFinancialProgress')?.value,
			aheadBehind: document.getElementById('journalAheadBehind')?.value,
			goalThisMonth: document.getElementById('journalGoalThisMonth')?.value,
			primaryJob: document.getElementById('journalPrimaryJob')?.value,
			secondaryJob: document.getElementById('journalSecondaryJob')?.value,
			volunteerOpportunities: document.getElementById('journalVolunteerOpportunities')?.value,
			reading: document.getElementById('journalReading')?.value,
			meetings: document.getElementById('journalMeetings')?.value,
			classes: document.getElementById('journalClasses')?.value,
			billingJob: document.getElementById('journalBillingJob')?.value,
			interests: document.getElementById('journalInterests')?.value,
			enjoying: document.getElementById('journalEnjoying')?.value,
			helpPeople: document.getElementById('journalHelpPeople')?.value,
			isStarred: hasActiveStarredSections(starredSections),
			starredNote: '',
			starredSections,
		})
	}
	const persistCurrentJournalForm = () => {
		const entry = readJournalFormEntry()
		const nextEntries = journalEntries.slice()
		const idx = nextEntries.findIndex((item) => item.month === entry.month)
		if (idx >= 0) nextEntries[idx] = entry
		else nextEntries.push(entry)
		saveJournalEntriesToStorage(nextEntries)
	}
	bindStarToggleButtons(journalForm)
	document.getElementById('updateMonthlyFinancialSnapshot')?.addEventListener('click', () => {
		const ownInput = /** @type {HTMLInputElement | null} */ (document.getElementById('journalOwn'))
		if (ownInput) ownInput.value = String(getCurrentSavingsForGoalProgress())
		persistCurrentJournalForm()
	})
	journalForm?.addEventListener('input', () => {
		persistCurrentJournalForm()
	})
	journalForm?.addEventListener('click', (event) => {
		const target = /** @type {HTMLElement | null} */ (event.target)
		if (target?.closest?.('[data-star-toggle]')) {
			persistCurrentJournalForm()
		}
	})
	journalForm?.addEventListener('submit', (event) => {
		event.preventDefault()
		const errorOut = document.getElementById('journalError')
		persistCurrentJournalForm()
		if (errorOut) {
			errorOut.hidden = true
			errorOut.textContent = ''
		}
		updateHabitTracker()
	})
}

function renderFreedomJournal() {
	if (!freedomJournalWrap) return
	if (!session) {
		freedomJournalWrap.innerHTML = '<div class="habit-gate">Log in to write in your journal.</div>'
		return
	}
	const entries = freedomJournalEntries.map((entry) => `<li class="habit-card"><div class="habit-card-head"><strong class="habit-card-week">${escapeHtml(entry.title || entry.freedomFive)}</strong><div class="habit-card-chip-row"><span class="habit-card-chip">${escapeHtml(entry.freedomFive)}</span><button type="button" class="star-toggle star-toggle--compact ${entry.isFavorite ? 'star-toggle--active' : ''}" data-toggle-freedom-journal-favorite="${escapeHtml(entry.id)}">${entry.isFavorite ? 'Favorited' : 'Favorite'}</button></div></div><div class="habit-card-text">${formatHabitText(entry.reflection)}</div><div class="metric-note">${escapeHtml(new Date(entry.createdAtMs).toLocaleDateString())}</div></li>`).join('')
	freedomJournalWrap.innerHTML = `<div class="report-shell"><div class="report-header report-header--journal"><div><div class="habit-kicker">Personal Journal</div><h3 class="report-title">The Freedom FIVES</h3><p class="habit-copy">Choose a Freedom FIVE or save a thought you want to remember.</p></div></div><form id="freedomJournalForm" class="habit-form report-form"><div class="report-block report-block--full"><div class="report-block-head"><div class="report-block-title">New Reflection</div></div><div class="habit-fields report-fields"><label class="auth-label"><span>Journal section</span><select id="freedomJournalFive" class="auth-input freedom-journal-select">${FREEDOM_FIVES.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('')}</select></label><label class="auth-label auth-label--wide"><span>Title (optional)</span><input id="freedomJournalTitle" class="auth-input" maxlength="120" placeholder="What do you want to remember?" /></label><label class="auth-label auth-label--wide"><span>My reflection</span><textarea id="freedomJournalReflection" class="auth-input habit-textarea habit-textarea--large" rows="6" maxlength="2000" required></textarea></label></div></div><div class="auth-actions"><button type="button" id="favoriteNewJournalReflection" data-star-toggle data-inactive-label="Favorite" data-active-label="Favorited" class="star-toggle star-toggle--compact">Favorite</button><button type="submit" class="auth-btn">Save Reflection</button></div><div id="freedomJournalError" class="auth-error" hidden></div></form>${entries ? `<div class="habit-list"><h3 class="habit-list-title">Past Reflections</h3><ul>${entries}</ul></div>` : ''}</div>`
	const form = /** @type {HTMLFormElement | null} */ (document.getElementById('freedomJournalForm'))
	bindStarToggleButtons(form)
	const archive = /** @type {HTMLDivElement | null} */ (freedomJournalWrap.querySelector('.habit-list'))
	applyArchiveListCollapsible(archive, 'freedom-journal-history', false)
	freedomJournalWrap.querySelectorAll('[data-toggle-freedom-journal-favorite]').forEach((node) => {
		node.addEventListener('click', () => {
			const entryId = String(node.getAttribute('data-toggle-freedom-journal-favorite') || '')
			saveFreedomJournalEntriesToStorage(freedomJournalEntries.map((entry) => entry.id === entryId ? { ...entry, isFavorite: !entry.isFavorite } : entry))
			renderFreedomJournal()
		})
	})
	form?.addEventListener('submit', (event) => {
		event.preventDefault()
		const reflection = String(document.getElementById('freedomJournalReflection')?.value || '').trim()
		const errorOut = document.getElementById('freedomJournalError')
		if (!reflection) {
			if (errorOut) {
				errorOut.textContent = 'Write a reflection before saving.'
				errorOut.hidden = false
			}
			return
		}
		saveFreedomJournalEntriesToStorage([...freedomJournalEntries, {
			id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			freedomFive: document.getElementById('freedomJournalFive')?.value,
			title: document.getElementById('freedomJournalTitle')?.value,
			reflection,
			isFavorite: document.getElementById('favoriteNewJournalReflection')?.classList.contains('star-toggle--active'),
			createdAtMs: Date.now(),
		}])
		renderFreedomJournal()
	})
}

function renderWeeklyReport() {
	const wrap = document.getElementById('weeklyReportWrap')
	if (!wrap) return
	if (!session) {
		wrap.innerHTML = '<div class="habit-gate">Log in to use the weekly report.</div>'
		return
	}
	const latest = getCurrentWeeklyReportEntry()
	const margin = latest.incomeJob1 + latest.incomeJob2 - latest.expenses
	let html = `<div class="report-shell"><div class="report-header"><div><div class="habit-kicker">This Week</div><h3 class="report-title">Weekly Report</h3><p class="habit-copy">Track meetings, books, lessons, and the weekly finance snapshot from the book.</p></div><div class="report-date-pill">Week of ${escapeHtml(formatDateLabel(latest.week))}</div></div><div class="report-quote-card"><div class="report-block-title">Weekly Thought</div><p>${escapeHtml(weeklyThought)}</p></div><form id="weeklyReportForm" class="habit-form report-form"><div class="report-columns"><div class="report-block"><div class="report-block-head"><div class="report-block-title">Meeting</div><button type="button" id="weeklyStarMeetings" data-star-toggle data-inactive-label="Favorite meetings" data-active-label="Favorited" class="star-toggle star-toggle--compact ${latest.starredSections?.meetings?.active ? 'star-toggle--active' : ''}">${latest.starredSections?.meetings?.active ? 'Favorited' : 'Favorite meetings'}</button></div><div class="habit-fields report-fields"><label class="auth-label auth-label--wide"><span>Who</span><input id="weeklyMeetingWho1" class="auth-input" maxlength="120" value="${escapeHtml(latest.meetingWho1)}" /></label><label class="auth-label auth-label--wide"><span>What I learned</span><textarea id="weeklyMeetingLearned1" class="auth-input habit-textarea" rows="3">${escapeHtml(latest.meetingLearned1)}</textarea></label><label class="auth-label auth-label--wide"><span>Who</span><input id="weeklyMeetingWho2" class="auth-input" maxlength="120" value="${escapeHtml(latest.meetingWho2)}" /></label><label class="auth-label auth-label--wide"><span>What I learned</span><textarea id="weeklyMeetingLearned2" class="auth-input habit-textarea" rows="3">${escapeHtml(latest.meetingLearned2)}</textarea></label></div></div><div class="report-block"><div class="report-block-head"><div class="report-block-title">Books</div><button type="button" id="weeklyStarBooks" data-star-toggle data-inactive-label="Favorite books" data-active-label="Favorited" class="star-toggle star-toggle--compact ${latest.starredSections?.books?.active ? 'star-toggle--active' : ''}">${latest.starredSections?.books?.active ? 'Favorited' : 'Favorite books'}</button></div><div class="habit-fields report-fields report-fields--books"><div class="report-stamp"><span>Week of</span><strong>${escapeHtml(formatDateLabel(latest.week))}</strong></div><div class="report-book-row"><label class="auth-label"><span>Book</span><input id="weeklyBook1" class="auth-input" maxlength="120" value="${escapeHtml(latest.book1)}" /></label><label class="auth-label"><span>Chapter</span><input id="weeklyBook1Chapter" class="auth-input" maxlength="60" value="${escapeHtml(latest.book1Chapter)}" /></label></div><label class="auth-label auth-label--wide"><span>What I learned</span><textarea id="weeklyBook1Learned" class="auth-input habit-textarea" rows="3">${escapeHtml(latest.book1Learned)}</textarea></label><div class="report-book-row report-book-row--offset"><label class="auth-label"><span>Book</span><input id="weeklyBook2" class="auth-input" maxlength="120" value="${escapeHtml(latest.book2)}" /></label><label class="auth-label"><span>Chapter</span><input id="weeklyBook2Chapter" class="auth-input" maxlength="60" value="${escapeHtml(latest.book2Chapter)}" /></label></div><label class="auth-label auth-label--wide"><span>What I learned</span><textarea id="weeklyBook2Learned" class="auth-input habit-textarea" rows="3">${escapeHtml(latest.book2Learned)}</textarea></label></div></div></div><div class="report-columns"><div class="report-block"><div class="report-block-head"><div class="report-block-title">Podcast, Videos, or Other Lessons</div><button type="button" id="weeklyStarLessons" data-star-toggle data-inactive-label="Favorite lessons" data-active-label="Favorited" class="star-toggle star-toggle--compact ${latest.starredSections?.lessons?.active ? 'star-toggle--active' : ''}">${latest.starredSections?.lessons?.active ? 'Favorited' : 'Favorite lessons'}</button></div><div class="habit-fields report-fields"><label class="auth-label auth-label--wide"><span>Title</span><input id="weeklyLessonTitle1" class="auth-input" maxlength="120" value="${escapeHtml(latest.lessonTitle1)}" /></label><label class="auth-label auth-label--wide"><span>What I learned</span><textarea id="weeklyLessonLearned1" class="auth-input habit-textarea" rows="3">${escapeHtml(latest.lessonLearned1)}</textarea></label><label class="auth-label auth-label--wide"><span>Title</span><input id="weeklyLessonTitle2" class="auth-input" maxlength="120" value="${escapeHtml(latest.lessonTitle2)}" /></label><label class="auth-label auth-label--wide"><span>What I learned</span><textarea id="weeklyLessonLearned2" class="auth-input habit-textarea" rows="3">${escapeHtml(latest.lessonLearned2)}</textarea></label></div></div></div><div class="report-block report-block--full"><div class="report-block-head"><div class="report-block-title">Finances</div><button type="button" id="weeklyStarFinances" data-star-toggle data-inactive-label="Favorite finances" data-active-label="Favorited" class="star-toggle star-toggle--compact ${latest.starredSections?.finances?.active ? 'star-toggle--active' : ''}">${latest.starredSections?.finances?.active ? 'Favorited' : 'Favorite finances'}</button></div><div class="habit-fields report-fields report-fields--financial"><label class="auth-label"><span>Income Job 1</span><input type="number" id="weeklyIncomeJob1" class="auth-input" min="0" step="1" value="${latest.incomeJob1}" /></label><label class="auth-label"><span>Income Job 2</span><input type="number" id="weeklyIncomeJob2" class="auth-input" min="0" step="1" value="${latest.incomeJob2}" /></label><label class="auth-label"><span>Expenses</span><input type="number" id="weeklyReportExpenses" class="auth-input" min="0" step="1" value="${latest.expenses}" /></label><div class="report-margin"><span>Margin</span><strong id="weeklyMarginValue">${formatSignedDollars(margin)}</strong></div></div></div><div class="auth-actions"><button type="submit" class="auth-btn">Save Weekly Report</button></div><div id="weeklyReportError" class="auth-error" hidden></div></form>`
	if (weeklyReports.length > 0) {
		html += `<div class="habit-list"><h3 class="habit-list-title">Past Weekly Reports</h3><ul>${weeklyReports.map((entry) => `<li class="habit-card"><div class="habit-card-head"><strong class="habit-card-week">Week of ${escapeHtml(formatDateLabel(entry.week))}</strong><div class="habit-card-chip-row"><span class="habit-card-chip">Margin ${formatSignedDollars(entry.incomeJob1 + entry.incomeJob2 - entry.expenses)}</span>${countActiveStarredSections(entry.starredSections) ? `<span class="habit-card-chip">${formatFavoriteCount(countActiveStarredSections(entry.starredSections))}</span>` : ''}</div></div><ul class="habit-card-grid"><li><span class="habit-card-label">Meetings</span><div class="habit-card-text">${formatHabitText([entry.meetingWho1 && `Who: ${entry.meetingWho1}`, entry.meetingLearned1, entry.meetingWho2 && `Who: ${entry.meetingWho2}`, entry.meetingLearned2].filter(Boolean).join('\n'))}</div></li><li><span class="habit-card-label">Books</span><div class="habit-card-text">${formatHabitText([entry.book1 && `${entry.book1} (${entry.book1Chapter})`, entry.book1Learned, entry.book2 && `${entry.book2} (${entry.book2Chapter})`, entry.book2Learned].filter(Boolean).join('\n'))}</div></li><li class="habit-card-grid-wide"><span class="habit-card-label">Lessons</span><div class="habit-card-text">${formatHabitText([entry.lessonTitle1 && `${entry.lessonTitle1}: ${entry.lessonLearned1}`, entry.lessonTitle2 && `${entry.lessonTitle2}: ${entry.lessonLearned2}`].filter(Boolean).join('\n'))}</div></li></ul></li>`).join('')}</ul></div>`
	}
	html += '</div>'
	wrap.innerHTML = html
	const weeklyReportForm = document.getElementById('weeklyReportForm')
	enhanceWeeklyReportLayout(weeklyReportForm, latest)
	applyReportFormCollapsibleSections(weeklyReportForm, 'weekly')
	const weeklyArchive = /** @type {HTMLDivElement | null} */ (wrap.querySelector('.habit-list'))
	applyArchiveListCollapsible(weeklyArchive, 'weekly-history', false)
	bindStarToggleButtons(weeklyReportForm)
	const weeklyFinancialFields = weeklyReportForm?.querySelector('.report-fields--financial')
	weeklyFinancialFields?.insertAdjacentHTML('beforeend', '<div class="auth-actions"><button type="button" class="auth-btn auth-btn--secondary" id="updateWeeklyFinancialSnapshot">Update from Financial</button></div>')
	const readWeeklyReportFormEntry = () => {
		const starredSections = {
			meetings: readStarredSection('weeklyStarMeetings'),
			books: readStarredSection('weeklyStarBooks'),
			lessons: readStarredSection('weeklyStarLessons'),
			finances: readStarredSection('weeklyStarFinances'),
		}
		return sanitizeWeeklyReportEntry({
			week: getCurrentWeekIso(),
			meetingWho1: document.getElementById('weeklyMeetingWho1')?.value,
			meetingLearned1: document.getElementById('weeklyMeetingLearned1')?.value,
			meetingWho2: document.getElementById('weeklyMeetingWho2')?.value,
			meetingLearned2: document.getElementById('weeklyMeetingLearned2')?.value,
			book1: document.getElementById('weeklyBook1')?.value,
			book1Chapter: document.getElementById('weeklyBook1Chapter')?.value,
			book1Learned: document.getElementById('weeklyBook1Learned')?.value,
			book2: document.getElementById('weeklyBook2')?.value,
			book2Chapter: document.getElementById('weeklyBook2Chapter')?.value,
			book2Learned: document.getElementById('weeklyBook2Learned')?.value,
			lessonTitle1: document.getElementById('weeklyLessonTitle1')?.value,
			lessonLearned1: document.getElementById('weeklyLessonLearned1')?.value,
			lessonTitle2: document.getElementById('weeklyLessonTitle2')?.value,
			lessonLearned2: document.getElementById('weeklyLessonLearned2')?.value,
			incomeJob1: document.getElementById('weeklyIncomeJob1')?.value,
			incomeJob2: document.getElementById('weeklyIncomeJob2')?.value,
			expenses: document.getElementById('weeklyReportExpenses')?.value,
			isStarred: hasActiveStarredSections(starredSections),
			starredNote: '',
			starredSections,
		})
	}
	const persistCurrentWeeklyReportForm = () => {
		const entry = readWeeklyReportFormEntry()
		const nextEntries = weeklyReports.slice()
		const idx = nextEntries.findIndex((item) => item.week === entry.week)
		if (idx >= 0) nextEntries[idx] = entry
		else nextEntries.push(entry)
		saveWeeklyReportsToStorage(nextEntries)
	}
	const updateWeeklyMargin = () => {
		const income1 = Number(document.getElementById('weeklyIncomeJob1')?.value || 0)
		const income2 = Number(document.getElementById('weeklyIncomeJob2')?.value || 0)
		const expenses = Number(document.getElementById('weeklyReportExpenses')?.value || 0)
		const marginOut = document.getElementById('weeklyMarginValue')
		if (marginOut) marginOut.textContent = formatSignedDollars(income1 + income2 - expenses)
	}
	document.getElementById('updateWeeklyFinancialSnapshot')?.addEventListener('click', () => {
		const totals = buildPeriodSeries('week', startOfLocalDayMs(new Date())).totals
		const income1Input = /** @type {HTMLInputElement | null} */ (document.getElementById('weeklyIncomeJob1'))
		const income2Input = /** @type {HTMLInputElement | null} */ (document.getElementById('weeklyIncomeJob2'))
		const expensesInput = /** @type {HTMLInputElement | null} */ (document.getElementById('weeklyReportExpenses'))
		if (income1Input) income1Input.value = String(totals.incomeDollars)
		if (income2Input) income2Input.value = '0'
		if (expensesInput) expensesInput.value = String(totals.expensesDollars)
		updateWeeklyMargin()
		persistCurrentWeeklyReportForm()
	})
	weeklyReportForm?.addEventListener('input', (event) => {
		const target = /** @type {HTMLInputElement | HTMLTextAreaElement | null} */ (event.target)
		if (!target) return
		if (target.id === 'weeklyIncomeJob1' || target.id === 'weeklyIncomeJob2' || target.id === 'weeklyReportExpenses') updateWeeklyMargin()
		persistCurrentWeeklyReportForm()
	})
	weeklyReportForm?.addEventListener('click', (event) => {
		const target = /** @type {HTMLElement | null} */ (event.target)
		if (target?.closest?.('[data-star-toggle]')) {
			persistCurrentWeeklyReportForm()
		}
	})
	weeklyReportForm?.addEventListener('submit', (event) => {
		event.preventDefault()
		persistCurrentWeeklyReportForm()
		renderWeeklyReport()
		showHabitPopups()
	})
}

// Insert the habit tracker panel into the habits page
window.addEventListener('DOMContentLoaded', () => {
	updateHabitTracker();
	renderWeeklyReport();
});

// Show habit popups on dashboard
function showHabitPopups() {
	const container = document.getElementById('habitPopupContainer');
	if (!container) return;
	container.innerHTML = '';
	if (!session || !weeklyReports.length) return;
	const latest = weeklyReports[0];
	const margin = latest.incomeJob1 + latest.incomeJob2 - latest.expenses
	const popup = document.createElement('div');
	popup.className = 'habit-popup';
	popup.innerHTML = `
		<div class="habit-popup-inner">
			<div class="habit-popup-head">
				<strong>Latest Weekly Report</strong>
				<span class="habit-popup-week">${escapeHtml(formatDateLabel(latest.week))}</span>
			</div>
			<div class="habit-popup-grid">
				<div><span class="habit-card-label">Meeting</span><div class="habit-card-text">${formatHabitText([latest.meetingWho1 && `Who: ${latest.meetingWho1}`, latest.meetingLearned1].filter(Boolean).join('\n'))}</div></div>
				<div><span class="habit-card-label">Books</span><div class="habit-card-text">${formatHabitText([latest.book1 && `${latest.book1} (${latest.book1Chapter})`, latest.book1Learned].filter(Boolean).join('\n'))}</div></div>
				<div class="habit-popup-grid-wide"><span class="habit-card-label">Lessons</span><div class="habit-card-text">${formatHabitText([latest.lessonTitle1 && `${latest.lessonTitle1}: ${latest.lessonLearned1}`, latest.lessonTitle2 && `${latest.lessonTitle2}: ${latest.lessonLearned2}`].filter(Boolean).join('\n'))}</div></div>
				<div><span class="habit-card-label">Income</span><div class="habit-card-text">${formatDollars(latest.incomeJob1 + latest.incomeJob2)}</div></div>
				<div><span class="habit-card-label">Margin</span><div class="habit-card-text">${formatSignedDollars(margin)}</div></div>
			</div>
		</div>
	`;
	container.appendChild(popup);
}

function renderStarredHighlights() {
	if (!starredHighlightsWrap) return
	if (!session) {
		starredHighlightsWrap.innerHTML = '<div class="habit-gate">Log in to view your favorites.</div>'
		return
	}
	const collections = getFavoriteCollections()
	if (!collections.length) {
		starredHighlightsWrap.innerHTML = '<div class="starred-panel"><div class="starred-panel-head"><div><div class="starred-panel-title">Favorites</div><p class="metric-note">Save important journal, weekly, and daily entries here for review.</p></div></div><div class="breakdown-empty">Favorite a day, week, or month entry to pin it here.</div></div>'
		return
	}
	if (selectedFavoritesTab && !collections.some((collection) => collection.id === selectedFavoritesTab)) selectedFavoritesTab = ''
	const selectedCollection = collections.find((collection) => collection.id === selectedFavoritesTab)
	if (!selectedCollection) {
		const total = collections.reduce((count, collection) => count + collection.items.length, 0)
		starredHighlightsWrap.innerHTML = `<div class="starred-panel"><div class="starred-panel-head"><div><div class="starred-panel-title">Favorites</div><p class="metric-note">Open a category to review its saved entries.</p></div><span class="habit-card-chip">${escapeHtml(formatFavoriteCount(total))}</span></div><div class="favorites-tab-grid">${collections.map((collection) => `<button type="button" class="favorites-tab-card" data-action="open-favorites-tab" data-favorites-tab="${escapeHtml(collection.id)}"><div class="favorites-tab-card-head"><strong>${escapeHtml(collection.title)}</strong><span class="habit-card-chip">${escapeHtml(formatFavoriteCount(collection.items.length))}</span></div><span class="metric-note">${escapeHtml(collection.description)}</span></button>`).join('')}</div></div>`
		return
	}
	const itemsByCategory = selectedCollection.items.reduce((acc, item) => {
		if (!acc[item.category]) acc[item.category] = []
		acc[item.category].push(item)
		return acc
	}, /** @type {Record<string, Array<{ category: string, label: string, summary: string, sortValue: string }>>} */ ({}))
	starredHighlightsWrap.innerHTML = `<div class="starred-panel"><div class="starred-panel-head favorites-detail-head"><div><button type="button" class="auth-btn auth-btn--secondary favorites-back-btn" data-action="back-to-favorites-tabs">Back to Favorites</button><div class="starred-panel-title">${escapeHtml(selectedCollection.title)} Favorites</div><p class="metric-note">Grouped first by tab, then by category inside this page.</p></div><span class="habit-card-chip">${escapeHtml(formatFavoriteCount(selectedCollection.items.length))}</span></div><div class="favorites-category-list">${Object.entries(itemsByCategory).map(([category, items]) => `<section class="favorites-category-group"><div class="favorites-category-head"><h3 class="report-block-title">${escapeHtml(category)}</h3><span class="habit-card-chip">${escapeHtml(formatFavoriteCount(items.length))}</span></div><div class="starred-list">${items.map((item) => `<article class="starred-item"><div class="starred-item-head"><strong>${escapeHtml(item.label)}</strong></div><div class="starred-item-summary">${formatHabitText(item.summary || 'Favorited item')}</div></article>`).join('')}</div></section>`).join('')}</div></div>`
}

function enhanceInstructorRosterLayout(students) {
	if (!instructorWrap) return
	const rosterCards = Array.from(instructorWrap.querySelectorAll('.instructor-student-card'))
	const encouragementEditor = document.createElement('form')
	encouragementEditor.className = 'instructor-panel instructor-form instructor-panel--compact'
	encouragementEditor.innerHTML = `<div class="instructor-panel-head"><div><div class="habit-kicker">Weekly Encouragement</div><h3 class="instructor-panel-title">Weekly Thought</h3></div></div><label class="auth-label"><span>Message for students</span><textarea class="auth-input habit-textarea" rows="3" maxlength="600" required>${escapeHtml(weeklyThought)}</textarea></label><div class="auth-actions"><button type="submit" class="auth-btn">Update Weekly Thought</button></div><div class="auth-error" hidden></div>`
	instructorWrap.querySelector('.instructor-shell')?.prepend(encouragementEditor)
	encouragementEditor.addEventListener('submit', (event) => {
		event.preventDefault()
		const textarea = encouragementEditor.querySelector('textarea')
		const nextThought = String(textarea?.value || '').trim()
		const status = encouragementEditor.querySelector('.auth-error')
		if (!nextThought) return
		weeklyThought = nextThought.slice(0, 600)
		try { localStorage.setItem(WEEKLY_THOUGHT_STORAGE_KEY, weeklyThought) } catch { /* keep session value */ }
		renderWeeklyThought()
		renderWeeklyReport()
		if (status) {
			status.textContent = 'Weekly thought updated.'
			status.hidden = false
		}
	})
	rosterCards.forEach((card, index) => {
		const student = students[index]
		if (!student) return
		card.classList.add('instructor-student-card--structured')
		const detailGrid = card.querySelector('.instructor-student-details')
		detailGrid?.classList.add('instructor-student-details--structured')
		const snapshotList = card.querySelector('.instructor-mini-list')
		if (snapshotList && !snapshotList.querySelector('[data-profile-additions]')) {
			snapshotList.insertAdjacentHTML('beforeend', `<li data-profile-additions>Good at: ${escapeHtml(truncateText(student?.profile?.goodAt || 'Not listed', 90) || 'Not listed')}</li><li data-profile-additions>Enjoys: ${escapeHtml(truncateText(student?.profile?.enjoys || 'Not listed', 90) || 'Not listed')}</li>`)
		}
	})
}

function enhanceInstructorStudentLayout(selectedStudent) {
	if (!instructorStudentWrap) return
	const detailGrid = instructorStudentWrap.querySelector('.instructor-detail-grid')
	if (!detailGrid || detailGrid.querySelector('.instructor-detail-section')) return
	const panels = Array.from(detailGrid.querySelectorAll(':scope > .breakdown-panel'))
	if (!panels.length) return
	const groups = [
		{ title: 'Profile and direction', copy: 'Core profile details, interests, and growth areas.', items: panels.slice(0, 3) },
		{ title: 'Progress and activity', copy: 'Financial status, report recency, and habit follow-through.', items: panels.slice(3, 6) },
		{ title: 'Notifications', copy: 'Recent instructor communication for this student.', items: panels.slice(6) },
	]
	detailGrid.innerHTML = ''
	groups.filter((group) => group.items.length).forEach((group) => {
		const section = document.createElement('section')
		section.className = 'instructor-detail-section'
		section.innerHTML = `<div class="instructor-detail-section-head"><div><h4 class="breakdown-title">${escapeHtml(group.title)}</h4><p class="metric-note">${escapeHtml(group.copy)}</p></div></div>`
		const grid = document.createElement('div')
		grid.className = 'instructor-detail-section-grid'
		group.items.forEach((item) => grid.appendChild(item))
		section.appendChild(grid)
		detailGrid.appendChild(section)
	})
	const profileList = detailGrid.querySelector('.instructor-detail-section .instructor-mini-list')
	if (profileList && !profileList.querySelector('[data-profile-additions]')) {
		profileList.insertAdjacentHTML('beforeend', `<li data-profile-additions>Good at: ${formatHabitText(selectedStudent?.profile?.goodAt || 'No strengths-in-practice listed yet.')}</li><li data-profile-additions>Enjoys: ${formatHabitText(selectedStudent?.profile?.enjoys || 'No interests listed yet.')}</li>`)
	}
}

// Patch updateHabitTracker to also show popups
const origUpdateHabitTracker = updateHabitTracker;
updateHabitTracker = function() {
	origUpdateHabitTracker.apply(this, arguments);
	showHabitPopups();
	renderStarredHighlights();
};

// Render habit tracker on session change
function updateHabitTracker() {
	renderHabitTracker();
}

// Patch updateAuthUi to also update habit tracker
const origUpdateAuthUi = updateAuthUi;
updateAuthUi = function() {
	origUpdateAuthUi.apply(this, arguments);
	updateHabitTracker();
	renderWeeklyReport();
	renderHabitBoard();
	renderHabitBoxesPage();
	renderSettingsPanel();
};

app.innerHTML = `
	<div class="shell">
		<header class="topbar" aria-label="Site header">
			<div class="topbar-inner">
				<button class="topbar-menu-toggle" id="topbarMenuToggle" type="button" aria-expanded="false" aria-controls="primaryNavigation" aria-label="Open navigation menu"><span></span><span></span><span></span></button>
				<nav class="topbar-nav" id="primaryNavigation" aria-label="Primary" hidden>
					<div class="topbar-drawer-head"><div class="topbar-brand">The Freedom Program</div><button class="auth-btn auth-btn--secondary topbar-logout" id="topbarLogoutBtn" type="button" hidden>Log out</button></div>
					<a class="topbar-link" id="dashboardNavLink" href="#dashboard">Dashboard</a>
					<a class="topbar-link" id="detailsNavLink" href="#details">Financial</a>
					<a class="topbar-link" id="monthlyReportNavLink" href="#monthly-report">Monthly Report</a>
					<a class="topbar-link" id="journalNavLink" href="#journal">Journal</a>
					<a class="topbar-link" id="weeklyNavLink" href="#weekly">Weekly Report</a>
					<a class="topbar-link" id="habitsNavLink" href="#habits">Habits</a>
					<a class="topbar-link" id="habitBoxesNavLink" href="#habit-boxes" hidden>Habit Boxes</a>
					<a class="topbar-link" id="instructorNavLink" href="#instructor" hidden>Instructor</a>
					<a class="topbar-link" id="studentDetailNavLink" href="#instructor-student" hidden>Student Detail</a>
					<a class="topbar-link" id="superAdminNavLink" href="#super-admin" hidden>Super Admin</a>
					<a class="topbar-link" id="starredNavLink" href="#starred">Favorites</a>
					<a class="topbar-link" id="settingsNavLink" href="#settings">Settings</a>
				</nav>
			</div>
		</header>

		<section class="hero" id="home" aria-label="Homepage hero">
			<div class="hero-inner">
				<div class="hero-brand" aria-label="Freedom Program">
					<img class="hero-logo" id="heroLogo" src="${heroLogoUrl}" alt="Freedom Program logo" hidden />
					<div class="mark" id="heroMark" aria-hidden="true">
						<div class="mark-rays"></div>
						<div class="mark-core"></div>
					</div>
				</div>
				<div id="notificationInboxWrap"></div>
			</div>
		</section>

		<section class="panel" id="dashboard" aria-label="Dashboard">
			<h2>Dashboard</h2>
			<div class="auth" id="authWrap" aria-label="Account">
				<div class="auth-row">
					<div class="auth-status" id="authStatus">Not logged in</div>
				</div>
				<div class="auth-mode" id="authModeSwitch" aria-label="Account mode">
					<button class="auth-mode-btn auth-mode-btn--active" id="authModeLoginBtn" type="button">Log in</button>
					<button class="auth-mode-btn" id="authModeRegisterBtn" type="button">Create account</button>
				</div>
				<div class="auth-hint" id="authHint">Use your email and password to log in.</div>
				<div class="auth-profile-summary" id="profileSummary" hidden>
					<div class="auth-profile-copy">
						<div class="auth-profile-label">Name</div>
						<div class="auth-profile-value" id="profileCurrentName">No name set</div>
					</div>
					<div class="auth-profile-copy">
						<div class="auth-profile-label">Email</div>
						<div class="auth-profile-value" id="profileCurrentEmail">No email set</div>
					</div>
					<div class="auth-profile-copy auth-profile-copy--wide">
						<div class="auth-profile-label">Contact Info</div>
						<div class="auth-profile-value auth-profile-value--body" id="profileCurrentContact">Add contact info in Settings.</div>
					</div>
					<div class="auth-profile-note">Edit name, email, and contact info in Settings.</div>
				</div>
				<form class="auth-form" id="authForm" autocomplete="on">
					<label class="auth-label" id="authNameField" hidden>
						<span>Name</span>
						<input id="authName" class="auth-input" type="text" autocomplete="name" maxlength="120" />
					</label>
					<label class="auth-label">
						<span>Email</span>
						<input id="authEmail" class="auth-input" type="email" autocomplete="username" inputmode="email" />
					</label>
					<label class="auth-label">
						<span>Password</span>
						<input id="authPassword" class="auth-input" type="password" autocomplete="current-password" minlength="8" />
					</label>
					<div class="auth-actions">
						<button class="auth-btn" id="loginBtn" type="submit">Log in</button>
						<button class="auth-btn auth-btn--secondary" id="registerBtn" type="button">Create account instead</button>
					</div>
					<div class="auth-error" id="authError" role="status" aria-live="polite" hidden></div>
				</form>
			</div>

			<div class="dashboard-gate" id="dashboardGate" role="status" aria-live="polite">
				Log in to view your summaries and goal progress.
			</div>

			<div id="dashboardContent" hidden>
				<div id="dashboardNotificationInboxWrap"></div>
				<section class="breakdown-panel" id="dashboardEncouragement" aria-label="Weekly encouragement">
					<div class="habit-kicker">Weekly Encouragement</div>
					<div class="habit-card-text" id="dashboardWeeklyThought">Deep satisfaction is the natural and proper fruit of a job well done.</div>
				</section>

				<div class="readout" aria-label="Savings goal readout">
					<span class="readout-label">Savings Goal</span>
					<output class="readout-value" id="rocketValue" for="rocketRange">$0</output>
					<span class="readout-max">Max $${(MAX * DOLLARS_PER_UNIT).toLocaleString()}</span>
					<button class="auth-btn auth-btn--secondary readout-edit-btn" id="goalEditBtn" type="button" hidden>Edit goal</button>
				</div>

				<div class="sliderWrap">
					<div class="rocket" id="rocket" aria-hidden="true">🚀</div>
					<input
						id="rocketRange"
						class="range"
						type="range"
						min="${MIN}"
						max="${MAX}"
						step="1"
						value="${MIN}"
						aria-label="Target savings slider from $0 to $${(MAX * DOLLARS_PER_UNIT).toLocaleString()}"
					/>
					<div class="minmax" aria-hidden="true">
						<span>${MIN}</span>
						<span>${MAX}</span>
					</div>
					<div class="sliderHint" id="goalSliderHint">Set your goal once, then use Edit goal if you want to change it later.</div>
				</div>

				<div class="progress" aria-label="Progress toward goal">
					<div class="bar" aria-label="Bar graph of current savings compared to 4-year goal">
						<div class="bar-track" role="img" aria-label="Current savings as a percentage of your 4-year goal">
							<div class="bar-fill" id="goalBarFill" style="width: 0%"></div>
						</div>
						<div class="bar-meta" aria-hidden="true">
							<span class="bar-current" id="barCurrent">Current: $0</span>
							<span class="bar-goal" id="barGoal">Goal: $0</span>
						</div>
					</div>
				</div>

				<div class="goal-plan" aria-label="Savings goal timeline and weekly target">
					<div class="summary-grid summary-grid--compact">
						<div class="metric" aria-label="Goal start date">
							<div class="metric-label">Start Date</div>
							<div class="metric-value metric-value--small" id="goalStartDate">--</div>
						</div>
						<div class="metric" aria-label="Goal end date">
							<div class="metric-label">End Date</div>
							<div class="metric-value metric-value--small" id="goalEndDate">--</div>
						</div>
						<div class="metric" aria-label="Weekly target needed to hit goal">
							<div class="metric-label">Needed Per Week</div>
							<div class="metric-value metric-value--small" id="goalWeeklyTarget">$0</div>
							<div class="metric-note" id="goalWeeklyCopy">Set a timeline in Settings.</div>
						</div>
					</div>
				</div>

				<section class="breakdown-panel dashboard-habit-focus" id="dashboardHabitFocus" aria-label="Today habit summary" hidden>
					<div class="details-simple-head">
						<h3 class="breakdown-title">Today Focus</h3>
						<span class="habit-card-chip" id="dashboardHabitChecks">0/0 habits today</span>
					</div>
					<div class="metric-note" id="dashboardHabitCopy">Set up Habit Boxes to track today.</div>
				</section>

				<div class="auth-actions financial-overview-trigger-row">
					<button type="button" class="auth-btn auth-btn--secondary" id="openFinancialOverviewBtn">View Financial Overview</button>
				</div>

				<dialog class="financial-breakdown-modal" id="olderNotificationsModal" aria-labelledby="olderNotificationsTitle">
					<div class="financial-breakdown-modal-shell">
						<div class="financial-breakdown-modal-head">
							<h3 class="breakdown-title" id="olderNotificationsTitle">Older Notifications</h3>
							<button type="button" class="auth-btn auth-btn--secondary" id="closeOlderNotificationsBtn">Close</button>
						</div>
						<div class="metric-note" id="olderNotificationsSummary">Older notifications are listed below.</div>
						<div id="olderNotificationsList" class="instructor-notification-list"></div>
					</div>
				</dialog>
			</div>
		</section>

		<section class="panel" id="monthly-report" aria-label="Monthly Report" hidden>
			<h2>Monthly Report</h2>
			<div id="habitTrackerWrap"></div>
		</section>

		<section class="panel" id="journal" aria-label="Journal" hidden>
			<h2>Journal</h2>
			<div id="freedomJournalWrap"></div>
		</section>

		<section class="panel" id="weekly" aria-label="Weekly Report" hidden>
			<h2>Weekly Report</h2>
			<div id="weeklyReportWrap"></div>
		</section>

		<section class="panel" id="starred" aria-label="Favorites" hidden>
			<h2>Favorites</h2>
			<div id="starredHighlightsWrap"></div>
		</section>

		<section class="panel" id="habits" aria-label="Habit Tracker" hidden>
			<h2>Habit Tracker</h2>
			<div id="habitBoardWrap"></div>
		</section>

		<section class="panel" id="habit-boxes" aria-label="Habit Boxes" hidden>
			<h2>Habit Boxes</h2>
			<div id="habitBoxesWrap"></div>
		</section>

		<section class="panel" id="instructor" aria-label="Instructor" hidden>
			<h2>Instructor</h2>
			<div id="instructorWrap"></div>
		</section>

		<section class="panel" id="instructor-student" aria-label="Instructor Student Detail" hidden>
			<h2>Student Detail</h2>
			<div id="instructorStudentWrap"></div>
		</section>

		<section class="panel" id="super-admin" aria-label="Super Admin" hidden>
			<h2>Super Admin</h2>
			<div id="superAdminWrap"></div>
		</section>

		<section class="panel" id="settings" aria-label="Settings" hidden>
			<h2>Settings</h2>
			<div id="settingsWrap"></div>
		</section>

		<section class="panel" id="details" aria-label="Financial" hidden>
			<h2>Financial</h2>
			<div class="auth-actions financial-overview-trigger-row">
				<button type="button" class="auth-btn auth-btn--secondary" id="openFinancialOverviewBtnDetails">View Financial Overview</button>
			</div>
			<form class="details-simple" id="entryForm" aria-label="Financial sliders and progress">
				<div class="details-simple-grid">
					<div class="details-simple-card" id="incomeCardToggle">
						<div class="details-simple-head"><strong>Income</strong><span id="entryIncomeValue">$0</span></div>
						<input id="entryIncome" class="range details-simple-range" type="range" min="0" max="10000" step="25" value="0" aria-label="Income slider" />
						<div class="details-slider-position" id="entryIncomePosition">0%</div>
						<div class="auth-actions"><button type="button" class="auth-btn auth-btn--secondary" data-breakdown-target="income">View income breakdown</button></div>
					</div>
					<div class="details-simple-card" id="expenseCardToggle">
						<div class="details-simple-head"><strong>Expenses</strong><span id="entryExpensesValue">$0</span></div>
						<input id="entryExpenses" class="range details-simple-range" type="range" min="0" max="10000" step="25" value="0" aria-label="Expenses slider" />
						<div class="details-slider-position" id="entryExpensesPosition">0%</div>
						<div class="auth-actions"><button type="button" class="auth-btn auth-btn--secondary" data-breakdown-target="expenses">View expense breakdown</button></div>
					</div>
					<div class="details-simple-card details-simple-card--progress" aria-live="polite">
						<div class="details-simple-head"><strong>Progress</strong><span id="entryProgressPct">0%</span></div>
						<div class="summary-grid summary-grid--compact">
							<div class="metric"><div class="metric-label">Income</div><div class="metric-value metric-value--small" id="progressIncomeValue">$0</div></div>
							<div class="metric"><div class="metric-label">Expenses</div><div class="metric-value metric-value--small" id="progressExpensesValue">$0</div></div>
							<div class="metric"><div class="metric-label">Net</div><div class="metric-value metric-value--small" id="progressNetValue">$0</div></div>
						</div>
						<div class="bar" aria-label="Progress bar for net from income minus expenses">
							<div class="bar-track"><div class="bar-fill" id="entryProgressBar" style="width: 0%"></div></div>
						</div>
					</div>
				</div>

				<dialog class="financial-breakdown-modal" id="financialBreakdownModal" aria-labelledby="financialBreakdownModalTitle">
					<div class="financial-breakdown-modal-shell">
						<div class="financial-breakdown-modal-head">
							<h3 class="breakdown-title" id="financialBreakdownModalTitle">Income Breakdown</h3>
							<button type="button" class="auth-btn auth-btn--secondary" id="closeBreakdownModalBtn">Close</button>
						</div>
						<div class="metric-note">Optional feature: use categories if you want a more detailed money breakdown.</div>

						<div class="details-breakdowns details-breakdowns--modal">
							<section class="breakdown-panel" id="incomeBreakdownPanel" hidden>
								<h3 class="breakdown-title">Income Breakdown</h3>
								<div class="entry-section-grid">
									<label class="auth-label">
										<span>Income category</span>
										<select id="entryIncomeSource" class="auth-input financial-category-select" aria-label="Income category"></select>
									</label>
									<label class="auth-label">
										<span>Amount to allocate ($)</span>
										<input id="incomeAllocationAmount" class="auth-input" type="number" inputmode="numeric" min="0" step="1" value="0" aria-label="Income allocation amount" />
									</label>
									<label class="auth-label auth-label--wide">
										<span>Income note</span>
										<input id="entryIncomeNote" class="auth-input" type="text" maxlength="240" placeholder="Optional note about the income" aria-label="Income note" />
									</label>
								</div>
								<div class="auth-actions allocation-action-row"><button type="button" class="auth-btn auth-btn--secondary" id="addIncomeAllocationBtn">Add Income Allocation</button><span class="metric-note" id="incomeAllocationTotal">Allocated: $0</span></div>
								<h4 class="breakdown-subtitle">Current Income Allocations</h4>
								<div id="incomeAllocationList" class="details-category-list"></div>
								<details class="category-manager"><summary>Manage income categories</summary><div class="auth-actions details-category-add-row"><input id="newIncomeCategoryInput" class="auth-input" type="text" maxlength="60" placeholder="New income category" aria-label="New income category" /><button type="button" class="auth-btn auth-btn--secondary" id="addIncomeCategoryBtn">Add</button><button type="button" class="auth-btn auth-btn--secondary" id="renameIncomeCategoryBtn">Rename selected</button></div></details>
							</section>

							<section class="breakdown-panel" id="expenseBreakdownPanel" hidden>
								<h3 class="breakdown-title">Expense Breakdown</h3>
								<div class="entry-section-grid">
									<label class="auth-label">
										<span>Expense category</span>
										<select id="entryExpenseCategory" class="auth-input financial-category-select" aria-label="Expense category">
											<option value="Housing">Housing</option>
											<option value="Transportation">Transportation</option>
											<option value="Food">Food</option>
											<option value="Utilities">Utilities</option>
											<option value="Health">Health</option>
											<option value="Education">Education</option>
											<option value="Other">Other</option>
										</select>
									</label>
									<label class="auth-label">
										<span>Amount to allocate ($)</span>
										<input id="expenseAllocationAmount" class="auth-input" type="number" inputmode="numeric" min="0" step="1" value="0" aria-label="Expense allocation amount" />
									</label>
									<label class="auth-label auth-label--wide">
										<span>Expense note</span>
										<input id="entryExpenseNote" class="auth-input" type="text" maxlength="240" placeholder="Optional note about the expense" aria-label="Expense note" />
									</label>
								</div>
								<div class="auth-actions allocation-action-row"><button type="button" class="auth-btn auth-btn--secondary" id="addExpenseAllocationBtn">Add Expense Allocation</button><span class="metric-note" id="expenseAllocationTotal">Allocated: $0</span></div>
								<h4 class="breakdown-subtitle">Current Expense Allocations</h4>
								<div id="expenseAllocationList" class="details-category-list"></div>
								<details class="category-manager"><summary>Manage expense categories</summary><div class="auth-actions details-category-add-row"><input id="newExpenseCategoryInput" class="auth-input" type="text" maxlength="60" placeholder="New expense category" aria-label="New expense category" /><button type="button" class="auth-btn auth-btn--secondary" id="addExpenseCategoryBtn">Add</button></div></details>
							</section>
						</div>
					</div>
				</dialog>

				<div class="details-save-row">
					<label class="auth-label">
						<span>Entry date</span>
						<input id="entryDate" class="auth-input" type="date" aria-label="Entry date" />
					</label>
					<input id="entrySavings" type="hidden" value="0" />
					<div class="auth-actions">
						<button class="auth-btn auth-btn--secondary" id="entryCancelEditBtn" type="button" hidden>Cancel Edit</button>
						<button class="auth-btn" id="entryAddBtn" type="submit">Save Financial Entry</button>
					</div>
				</div>
				<div class="metric-note" id="entryEditState">Creating a new financial entry.</div>
				<div class="auth-error" id="entryError" role="status" aria-live="polite" hidden></div>
			</form>

			<section class="breakdown-panel" aria-label="Saved financial entries">
				<div class="details-simple-head">
					<h3 class="breakdown-title">Saved Entries</h3>
					<div class="auth-actions">
						<label class="auth-label"><span>Pick a date</span><input id="savedEntryDatePicker" class="auth-input" type="date" aria-label="Pick saved entry date" /></label>
					</div>
				</div>
				<div id="financialEntriesList"></div>
			</section>
		</section>

		<div id="spacer" aria-hidden="true"></div>

		<dialog class="financial-breakdown-modal" id="financialOverviewModal" aria-labelledby="financialOverviewTitle">
			<div class="financial-breakdown-modal-shell">
				<div class="financial-breakdown-modal-head">
					<h3 class="breakdown-title" id="financialOverviewTitle">Financial Overview</h3>
					<button type="button" class="auth-btn auth-btn--secondary" id="closeFinancialOverviewBtn">Close</button>
				</div>
				<div class="metric-note">A quick look at your monthly and yearly totals plus goal progress.</div>

				<section class="breakdown-panel">
					<h4 class="breakdown-subtitle">Goal Progress</h4>
					<div class="bar" aria-label="Goal progress bar">
						<div class="bar-track">
							<div class="bar-fill" id="overviewGoalBarFill" style="width: 0%"></div>
						</div>
						<div class="bar-meta" aria-hidden="true">
							<span class="bar-current" id="overviewGoalCurrent">Current: $0</span>
							<span class="bar-goal" id="overviewGoalGoal">Goal: $0</span>
						</div>
					</div>
					<div class="summary-grid summary-grid--compact">
						<div class="metric"><div class="metric-label">Percent to Goal</div><div class="metric-value metric-value--small" id="overviewGoalPct">0%</div></div>
						<div class="metric"><div class="metric-label">Needed Per Week</div><div class="metric-value metric-value--small" id="overviewGoalWeeklyTarget">$0</div></div>
					</div>
					<div class="metric-note" id="overviewGoalWeeklyCopy"></div>
				</section>

				<section class="breakdown-panel">
					<h4 class="breakdown-subtitle">This Month</h4>
					<div class="summary-grid summary-grid--compact">
						<div class="metric"><div class="metric-label">Income</div><div class="metric-value metric-value--small" id="overviewMonthlyIncome">$0</div></div>
						<div class="metric"><div class="metric-label">Expenses</div><div class="metric-value metric-value--small" id="overviewMonthlyExpenses">$0</div></div>
						<div class="metric"><div class="metric-label">Savings</div><div class="metric-value metric-value--small" id="overviewMonthlySavings">$0</div></div>
					</div>
				</section>

				<section class="breakdown-panel">
					<h4 class="breakdown-subtitle">This Year</h4>
					<div class="summary-grid summary-grid--compact">
						<div class="metric"><div class="metric-label">Income</div><div class="metric-value metric-value--small" id="overviewYearlyIncome">$0</div></div>
						<div class="metric"><div class="metric-label">Expenses</div><div class="metric-value metric-value--small" id="overviewYearlyExpenses">$0</div></div>
						<div class="metric"><div class="metric-label">Savings</div><div class="metric-value metric-value--small" id="overviewYearlySavings">$0</div></div>
					</div>
				</section>
			</div>
		</dialog>
	</div>
`

const range = /** @type {HTMLInputElement} */ (document.querySelector('#rocketRange'))
const valueOut = /** @type {HTMLOutputElement} */ (document.querySelector('#rocketValue'))
const rocket = /** @type {HTMLDivElement} */ (document.querySelector('#rocket'))
const goalEditBtn = /** @type {HTMLButtonElement} */ (document.querySelector('#goalEditBtn'))
const goalSliderHint = /** @type {HTMLDivElement} */ (document.querySelector('#goalSliderHint'))
const goalStartDateOut = /** @type {HTMLDivElement} */ (document.querySelector('#goalStartDate'))
const goalEndDateOut = /** @type {HTMLDivElement} */ (document.querySelector('#goalEndDate'))
const goalWeeklyTargetOut = /** @type {HTMLDivElement} */ (document.querySelector('#goalWeeklyTarget'))
const goalWeeklyCopyOut = /** @type {HTMLDivElement} */ (document.querySelector('#goalWeeklyCopy'))

const detailChartCanvas = /** @type {HTMLCanvasElement} */ (document.querySelector('#detailChart'))
const detailTooltip = /** @type {HTMLDivElement} */ (document.querySelector('#detailTooltip'))
const detailRange = /** @type {HTMLSpanElement} */ (document.querySelector('#detailRange'))
const fundSummaryWrap = /** @type {HTMLDivElement} */ (document.querySelector('#fundSummary'))
const entryFeedWrap = /** @type {HTMLDivElement} */ (document.querySelector('#entryFeed'))

const detailKindSelect = /** @type {HTMLSelectElement} */ (document.querySelector('#detailKind'))
const detailDateInput = /** @type {HTMLInputElement} */ (document.querySelector('#detailDate'))
const detailPrevBtn = /** @type {HTMLButtonElement} */ (document.querySelector('#detailPrev'))
const detailNextBtn = /** @type {HTMLButtonElement} */ (document.querySelector('#detailNext'))

const detailIncomeTotalOut = /** @type {HTMLDivElement} */ (document.querySelector('#detailIncomeTotal'))
const detailExpensesTotalOut = /** @type {HTMLDivElement} */ (document.querySelector('#detailExpensesTotal'))
const detailSavingsTotalOut = /** @type {HTMLDivElement} */ (document.querySelector('#detailSavingsTotal'))

const entryForm = /** @type {HTMLFormElement} */ (document.querySelector('#entryForm'))
const entryDateInput = /** @type {HTMLInputElement} */ (document.querySelector('#entryDate'))
const entryIncomeInput = /** @type {HTMLInputElement} */ (document.querySelector('#entryIncome'))
const entryIncomeValueOut = /** @type {HTMLSpanElement} */ (document.querySelector('#entryIncomeValue'))
const entryIncomePositionOut = /** @type {HTMLDivElement} */ (document.querySelector('#entryIncomePosition'))
const entryIncomeSourceInput = /** @type {HTMLSelectElement} */ (document.querySelector('#entryIncomeSource'))
const incomeAllocationAmountInput = /** @type {HTMLInputElement} */ (document.querySelector('#incomeAllocationAmount'))
const addIncomeAllocationBtn = /** @type {HTMLButtonElement} */ (document.querySelector('#addIncomeAllocationBtn'))
const incomeAllocationTotal = /** @type {HTMLSpanElement} */ (document.querySelector('#incomeAllocationTotal'))
const incomeAllocationList = /** @type {HTMLDivElement} */ (document.querySelector('#incomeAllocationList'))
const entryIncomeNoteInput = /** @type {HTMLInputElement} */ (document.querySelector('#entryIncomeNote'))
const entryExpensesInput = /** @type {HTMLInputElement} */ (document.querySelector('#entryExpenses'))
const entryExpensesValueOut = /** @type {HTMLSpanElement} */ (document.querySelector('#entryExpensesValue'))
const entryExpensesPositionOut = /** @type {HTMLDivElement} */ (document.querySelector('#entryExpensesPosition'))
const entryExpenseCategoryInput = /** @type {HTMLSelectElement} */ (document.querySelector('#entryExpenseCategory'))
const expenseAllocationAmountInput = /** @type {HTMLInputElement} */ (document.querySelector('#expenseAllocationAmount'))
const addExpenseAllocationBtn = /** @type {HTMLButtonElement} */ (document.querySelector('#addExpenseAllocationBtn'))
const expenseAllocationTotal = /** @type {HTMLSpanElement} */ (document.querySelector('#expenseAllocationTotal'))
const expenseAllocationList = /** @type {HTMLDivElement} */ (document.querySelector('#expenseAllocationList'))
const entryExpenseNoteInput = /** @type {HTMLInputElement} */ (document.querySelector('#entryExpenseNote'))
const entrySavingsInput = /** @type {HTMLInputElement} */ (document.querySelector('#entrySavings'))
const progressIncomeValueOut = /** @type {HTMLDivElement} */ (document.querySelector('#progressIncomeValue'))
const progressExpensesValueOut = /** @type {HTMLDivElement} */ (document.querySelector('#progressExpensesValue'))
const progressNetValueOut = /** @type {HTMLDivElement} */ (document.querySelector('#progressNetValue'))
const entryProgressPctOut = /** @type {HTMLSpanElement} */ (document.querySelector('#entryProgressPct'))
const entryProgressBar = /** @type {HTMLDivElement} */ (document.querySelector('#entryProgressBar'))
const financialBreakdownModal = /** @type {HTMLDialogElement} */ (document.querySelector('#financialBreakdownModal'))
const financialBreakdownModalTitle = /** @type {HTMLHeadingElement} */ (document.querySelector('#financialBreakdownModalTitle'))
const closeBreakdownModalBtn = /** @type {HTMLButtonElement} */ (document.querySelector('#closeBreakdownModalBtn'))
const incomeBreakdownPanel = /** @type {HTMLDivElement} */ (document.querySelector('#incomeBreakdownPanel'))
const expenseBreakdownPanel = /** @type {HTMLDivElement} */ (document.querySelector('#expenseBreakdownPanel'))
const financialCategoriesPanel = /** @type {HTMLDivElement} */ (document.querySelector('#financialCategoriesPanel'))
const openCategoriesBtn = /** @type {HTMLButtonElement} */ (document.querySelector('#openCategoriesBtn'))
const closeCategoriesBtn = /** @type {HTMLButtonElement} */ (document.querySelector('#closeCategoriesBtn'))
const expenseCategoryDisplay = /** @type {HTMLDivElement} */ (document.querySelector('#expenseCategoryDisplay'))
const incomeCategoryDisplay = /** @type {HTMLDivElement} */ (document.querySelector('#incomeCategoryDisplay'))
const newExpenseCategoryInput = /** @type {HTMLInputElement} */ (document.querySelector('#newExpenseCategoryInput'))
const newIncomeCategoryInput = /** @type {HTMLInputElement} */ (document.querySelector('#newIncomeCategoryInput'))
const addExpenseCategoryBtn = /** @type {HTMLButtonElement} */ (document.querySelector('#addExpenseCategoryBtn'))
const addIncomeCategoryBtn = /** @type {HTMLButtonElement} */ (document.querySelector('#addIncomeCategoryBtn'))
const renameIncomeCategoryBtn = /** @type {HTMLButtonElement} */ (document.querySelector('#renameIncomeCategoryBtn'))
const financialEntriesList = /** @type {HTMLDivElement} */ (document.querySelector('#financialEntriesList'))
const savedEntryDatePicker = /** @type {HTMLInputElement} */ (document.querySelector('#savedEntryDatePicker'))
const entryEditState = /** @type {HTMLDivElement} */ (document.querySelector('#entryEditState'))
const savingsCategoryListWrap = /** @type {HTMLDivElement} */ (document.querySelector('#savingsCategoryList'))
const entrySavingsRemainingOut = /** @type {HTMLSpanElement} */ (document.querySelector('#entrySavingsRemaining'))
const entryCategoryNameInput = /** @type {HTMLInputElement} */ (document.querySelector('#entryCategoryName'))
const entryAddCategoryBtn = /** @type {HTMLButtonElement} */ (document.querySelector('#entryAddCategoryBtn'))
const entryAddBtn = /** @type {HTMLButtonElement} */ (document.querySelector('#entryAddBtn'))
const entryCancelEditBtn = /** @type {HTMLButtonElement} */ (document.querySelector('#entryCancelEditBtn'))
const entryError = /** @type {HTMLDivElement} */ (document.querySelector('#entryError'))
const habitBoardWrap = /** @type {HTMLDivElement} */ (document.querySelector('#habitBoardWrap'))
const habitBoxesWrap = /** @type {HTMLDivElement} */ (document.querySelector('#habitBoxesWrap'))
const freedomJournalWrap = /** @type {HTMLDivElement} */ (document.querySelector('#freedomJournalWrap'))
const topbarMenuToggle = /** @type {HTMLButtonElement} */ (document.querySelector('#topbarMenuToggle'))
const primaryNavigation = /** @type {HTMLElement} */ (document.querySelector('#primaryNavigation'))
const habitBoxesNavLink = /** @type {HTMLAnchorElement} */ (document.querySelector('#habitBoxesNavLink'))
const instructorNavLink = /** @type {HTMLAnchorElement} */ (document.querySelector('#instructorNavLink'))
const studentDetailNavLink = /** @type {HTMLAnchorElement} */ (document.querySelector('#studentDetailNavLink'))
const superAdminNavLink = /** @type {HTMLAnchorElement} */ (document.querySelector('#superAdminNavLink'))
const topbarLogoutBtn = /** @type {HTMLButtonElement} */ (document.querySelector('#topbarLogoutBtn'))
const dashboardNavLink = /** @type {HTMLAnchorElement} */ (document.querySelector('#dashboardNavLink'))
const detailsNavLink = /** @type {HTMLAnchorElement} */ (document.querySelector('#detailsNavLink'))
const monthlyReportNavLink = /** @type {HTMLAnchorElement} */ (document.querySelector('#monthlyReportNavLink'))
const journalNavLink = /** @type {HTMLAnchorElement} */ (document.querySelector('#journalNavLink'))
const weeklyNavLink = /** @type {HTMLAnchorElement} */ (document.querySelector('#weeklyNavLink'))
const starredNavLink = /** @type {HTMLAnchorElement} */ (document.querySelector('#starredNavLink'))
const habitsNavLink = /** @type {HTMLAnchorElement} */ (document.querySelector('#habitsNavLink'))
const settingsNavLink = /** @type {HTMLAnchorElement} */ (document.querySelector('#settingsNavLink'))
const weeklyReportWrap = /** @type {HTMLDivElement} */ (document.querySelector('#weeklyReportWrap'))
const settingsWrap = /** @type {HTMLDivElement} */ (document.querySelector('#settingsWrap'))
const instructorWrap = /** @type {HTMLDivElement} */ (document.querySelector('#instructorWrap'))
const instructorStudentWrap = /** @type {HTMLDivElement} */ (document.querySelector('#instructorStudentWrap'))
const superAdminWrap = /** @type {HTMLDivElement} */ (document.querySelector('#superAdminWrap'))
const notificationInboxWrap = /** @type {HTMLDivElement} */ (document.querySelector('#notificationInboxWrap'))

const authWrap = /** @type {HTMLDivElement} */ (document.querySelector('#authWrap'))
const authStatus = /** @type {HTMLDivElement} */ (document.querySelector('#authStatus'))
const authHint = /** @type {HTMLDivElement} */ (document.querySelector('#authHint'))
const authModeSwitch = /** @type {HTMLDivElement} */ (document.querySelector('#authModeSwitch'))
const authModeLoginBtn = /** @type {HTMLButtonElement} */ (document.querySelector('#authModeLoginBtn'))
const authModeRegisterBtn = /** @type {HTMLButtonElement} */ (document.querySelector('#authModeRegisterBtn'))
const profileSummary = /** @type {HTMLDivElement} */ (document.querySelector('#profileSummary'))
const profileCurrentName = /** @type {HTMLDivElement} */ (document.querySelector('#profileCurrentName'))
const profileCurrentEmail = /** @type {HTMLDivElement} */ (document.querySelector('#profileCurrentEmail'))
const profileCurrentContact = /** @type {HTMLDivElement} */ (document.querySelector('#profileCurrentContact'))
const authForm = /** @type {HTMLFormElement} */ (document.querySelector('#authForm'))
const authNameField = /** @type {HTMLLabelElement} */ (document.querySelector('#authNameField'))
const authName = /** @type {HTMLInputElement} */ (document.querySelector('#authName'))
const authEmail = /** @type {HTMLInputElement} */ (document.querySelector('#authEmail'))
const authPassword = /** @type {HTMLInputElement} */ (document.querySelector('#authPassword'))
const loginBtn = /** @type {HTMLButtonElement} */ (document.querySelector('#loginBtn'))
const registerBtn = /** @type {HTMLButtonElement} */ (document.querySelector('#registerBtn'))
const authError = /** @type {HTMLDivElement} */ (document.querySelector('#authError'))

const dashboardGate = /** @type {HTMLDivElement} */ (document.querySelector('#dashboardGate'))
const dashboardContent = /** @type {HTMLDivElement} */ (document.querySelector('#dashboardContent'))
const dashboardNotificationInboxWrap = /** @type {HTMLDivElement} */ (document.querySelector('#dashboardNotificationInboxWrap'))
const dashboardHabitFocus = /** @type {HTMLElement} */ (document.querySelector('#dashboardHabitFocus'))
const dashboardWeeklyThought = /** @type {HTMLElement} */ (document.querySelector('#dashboardWeeklyThought'))
const dashboardHabitChecks = /** @type {HTMLSpanElement} */ (document.querySelector('#dashboardHabitChecks'))
const dashboardHabitCopy = /** @type {HTMLDivElement} */ (document.querySelector('#dashboardHabitCopy'))
const olderNotificationsModal = /** @type {HTMLDialogElement} */ (document.querySelector('#olderNotificationsModal'))
const closeOlderNotificationsBtn = /** @type {HTMLButtonElement} */ (document.querySelector('#closeOlderNotificationsBtn'))
const olderNotificationsSummary = /** @type {HTMLDivElement} */ (document.querySelector('#olderNotificationsSummary'))
const olderNotificationsList = /** @type {HTMLDivElement} */ (document.querySelector('#olderNotificationsList'))

const openFinancialOverviewBtn = /** @type {HTMLButtonElement} */ (document.querySelector('#openFinancialOverviewBtn'))
const openFinancialOverviewBtnDetails = /** @type {HTMLButtonElement} */ (document.querySelector('#openFinancialOverviewBtnDetails'))
const closeFinancialOverviewBtn = /** @type {HTMLButtonElement} */ (document.querySelector('#closeFinancialOverviewBtn'))
const financialOverviewModal = /** @type {HTMLDialogElement} */ (document.querySelector('#financialOverviewModal'))
const overviewGoalBarFill = /** @type {HTMLDivElement} */ (document.querySelector('#overviewGoalBarFill'))
const overviewGoalCurrentOut = /** @type {HTMLSpanElement} */ (document.querySelector('#overviewGoalCurrent'))
const overviewGoalGoalOut = /** @type {HTMLSpanElement} */ (document.querySelector('#overviewGoalGoal'))
const overviewGoalPctOut = /** @type {HTMLDivElement} */ (document.querySelector('#overviewGoalPct'))
const overviewGoalWeeklyTargetOut = /** @type {HTMLDivElement} */ (document.querySelector('#overviewGoalWeeklyTarget'))
const overviewGoalWeeklyCopyOut = /** @type {HTMLDivElement} */ (document.querySelector('#overviewGoalWeeklyCopy'))
const overviewMonthlyIncomeOut = /** @type {HTMLDivElement} */ (document.querySelector('#overviewMonthlyIncome'))
const overviewMonthlyExpensesOut = /** @type {HTMLDivElement} */ (document.querySelector('#overviewMonthlyExpenses'))
const overviewMonthlySavingsOut = /** @type {HTMLDivElement} */ (document.querySelector('#overviewMonthlySavings'))
const overviewYearlyIncomeOut = /** @type {HTMLDivElement} */ (document.querySelector('#overviewYearlyIncome'))
const overviewYearlyExpensesOut = /** @type {HTMLDivElement} */ (document.querySelector('#overviewYearlyExpenses'))
const overviewYearlySavingsOut = /** @type {HTMLDivElement} */ (document.querySelector('#overviewYearlySavings'))
const homeQuickAmountRange = /** @type {HTMLInputElement} */ (document.querySelector('#homeQuickAmountRange'))
const homeQuickAmountValue = /** @type {HTMLOutputElement} */ (document.querySelector('#homeQuickAmountValue'))
const homeStartAllocationBtn = /** @type {HTMLButtonElement} */ (document.querySelector('#homeStartAllocationBtn'))

const weeklySavingsOut = /** @type {HTMLDivElement} */ (document.querySelector('#weeklySavings'))
const weeklyExpensesOut = /** @type {HTMLDivElement} */ (document.querySelector('#weeklyExpenses'))
const monthlySavingsOut = /** @type {HTMLDivElement} */ (document.querySelector('#monthlySavings'))
const monthlyExpensesOut = /** @type {HTMLDivElement} */ (document.querySelector('#monthlyExpenses'))
const yearlySavingsOut = /** @type {HTMLDivElement} */ (document.querySelector('#yearlySavings'))
const yearlyExpensesOut = /** @type {HTMLDivElement} */ (document.querySelector('#yearlyExpenses'))
const starredHighlightsWrap = /** @type {HTMLDivElement} */ (document.querySelector('#starredHighlightsWrap'))

const goalBarFill = /** @type {HTMLDivElement} */ (document.querySelector('#goalBarFill'))
const barCurrent = /** @type {HTMLSpanElement} */ (document.querySelector('#barCurrent'))
const barGoal = /** @type {HTMLSpanElement} */ (document.querySelector('#barGoal'))

const heroLogo = /** @type {HTMLImageElement} */ (document.querySelector('#heroLogo'))
const heroMark = /** @type {HTMLDivElement} */ (document.querySelector('#heroMark'))

const GOAL_STORAGE_KEY = 'rocket-slider:goal-dollars:v1'
const LEDGER_STORAGE_PREFIX = 'freedom-program:ledger:v1:'
const LEDGER_CLOUD_SYNC_PREFIX = 'freedom-program:ledger-cloud-sync:v1:'
const LEDGER_CLOUD_PULL_PATH = '/ledger/pull'
const LEDGER_CLOUD_UPSERT_PATH = '/ledger/upsert'
const PROGRAM_YEARS = 4
const HABIT_BOARD_STORAGE_PREFIX = 'freedom-program:habit-board:v1:'
const PROFILE_SETTINGS_STORAGE_PREFIX = 'freedom-program:profile-settings:v1:'
const LEDGER_META_STORAGE_PREFIX = 'freedom-program:ledger-meta:v1:'
const SAVINGS_LOG_STORAGE_PREFIX = 'freedom-program:savings-log:v1:'
const SAVINGS_CATEGORY_STORAGE_PREFIX = 'freedom-program:savings-categories:v1:'
const EXPENSE_CATEGORY_STORAGE_PREFIX = 'freedom-program:expense-categories:v1:'
const INCOME_CATEGORY_STORAGE_PREFIX = 'freedom-program:income-categories:v1:'
const COLLAPSIBLE_UI_STORAGE_PREFIX = 'freedom-program:collapsible-ui:v1:'
const DEFAULT_FUND_NAMES = ['E-Fund', 'Car Fund', 'Next Big Fund']
const DEFAULT_EXPENSE_CATEGORIES = ['Housing', 'Transportation', 'Food', 'Utilities', 'Health', 'Education', 'Other']
const DEFAULT_INCOME_CATEGORIES = ['Job 1', 'Job 2', 'Sidehustle']

function getUserScopedStorageKey(prefix) {
	const email = String(session?.email || '').trim().toLowerCase()
	return `${prefix}${email || 'anonymous'}`
}

function loadScopedJson(prefix, fallback) {
	try {
		const raw = localStorage.getItem(getUserScopedStorageKey(prefix))
		if (!raw) return fallback
		return JSON.parse(raw)
	} catch {
		return fallback
	}
}

function loadScopedArray(prefix) {
	const data = loadScopedJson(prefix, [])
	return Array.isArray(data) ? data : []
}

function saveScopedJson(prefix, value) {
	try {
		localStorage.setItem(getUserScopedStorageKey(prefix), JSON.stringify(value))
	} catch {
		// ignore
	}
}

function sanitizeShortText(value, max = 120) {
	return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max)
}

function sanitizeLongText(value, max = 800) {
	return String(value || '').trim().slice(0, max)
}

function sanitizeDateString(value, fallbackMs) {
	const ms = parseDateInputToDayMs(value)
	if (!Number.isFinite(ms) || ms <= 0) return isoDateValue(fallbackMs)
	return isoDateValue(ms)
}

function normalizeFundName(value) {
	return sanitizeShortText(value, 60)
}

function sanitizeSavingsCategoryList(value) {
	if (!Array.isArray(value)) return []
	const seen = new Set(DEFAULT_FUND_NAMES)
	const out = []
	for (const item of value) {
		const safe = normalizeFundName(item)
		if (!safe || seen.has(safe)) continue
		seen.add(safe)
		out.push(safe)
		if (out.length >= 24) break
	}
	return out
}

function sanitizeNamedCategoryList(value, blocked = []) {
	if (!Array.isArray(value)) return []
	const seen = new Set(blocked.map((item) => String(item || '').toLowerCase()))
	const out = []
	for (const item of value) {
		const safe = sanitizeShortText(item, 60)
		const key = safe.toLowerCase()
		if (!safe || seen.has(key)) continue
		seen.add(key)
		out.push(safe)
		if (out.length >= 24) break
	}
	return out
}

function sanitizeExpenseCategoryList(value) {
	return sanitizeNamedCategoryList(value, DEFAULT_EXPENSE_CATEGORIES)
}

function sanitizeIncomeCategoryList(value) {
	return sanitizeNamedCategoryList(value)
}

function sanitizeCollapsibleUiState(value) {
	if (!value || typeof value !== 'object') return {}
	const out = {}
	for (const [key, expanded] of Object.entries(value)) {
		const safeKey = sanitizeShortText(key, 120)
		if (!safeKey) continue
		out[safeKey] = Boolean(expanded)
	}
	return out
}

function getAllExpenseCategories() {
	const base = DEFAULT_EXPENSE_CATEGORIES.filter((category) => category !== 'Other')
	return [...base, ...customExpenseCategories, 'Other']
}

function getAllIncomeCategories() {
	const fromEntries = []
	for (const entry of ledgerEntries) {
		const source = sanitizeShortText(getLedgerEntryMeta(entry?.clientId)?.incomeSource || '', 60)
		if (source) fromEntries.push(source)
	}
	const editableCategories = customIncomeCategories.length ? customIncomeCategories : DEFAULT_INCOME_CATEGORIES
	return sanitizeNamedCategoryList([...editableCategories, ...fromEntries])
}

function getAllSavingsCategories() {
	return [...DEFAULT_FUND_NAMES, ...customSavingsCategories]
}

function ensureEntryAllocationCategories() {
	for (const category of getAllSavingsCategories()) {
		if (!Number.isFinite(Number(entrySavingsAllocationDraft[category]))) {
			entrySavingsAllocationDraft[category] = 0
		}
	}
	for (const category of Object.keys(entrySavingsAllocationDraft)) {
		if (!getAllSavingsCategories().includes(category)) delete entrySavingsAllocationDraft[category]
	}
}

function getCurrentSavingsDraftAmount() {
	return Math.max(0, Math.round(Number(entrySavingsInput?.value) || 0))
}

function getAllocatedSavingsAmount() {
	let sum = 0
	for (const category of getAllSavingsCategories()) {
		sum += Math.max(0, Math.round(Number(entrySavingsAllocationDraft[category]) || 0))
	}
	return sum
}

function rebalanceEntryAllocationDraft(totalSavings) {
	let remaining = Math.max(0, Math.round(Number(totalSavings) || 0))
	for (const category of getAllSavingsCategories()) {
		const requested = Math.max(0, Math.round(Number(entrySavingsAllocationDraft[category]) || 0))
		const applied = Math.min(requested, remaining)
		entrySavingsAllocationDraft[category] = applied
		remaining -= applied
	}
}

function buildEntryFundsFromDraft(totalSavings) {
	const safeTotal = Math.max(0, Math.round(Number(totalSavings) || 0))
	const funds = {}
	let allocated = 0
	for (const category of getAllSavingsCategories()) {
		const amount = Math.max(0, Math.round(Number(entrySavingsAllocationDraft[category]) || 0))
		if (amount <= 0) continue
		funds[category] = amount
		allocated += amount
	}
	if (allocated > safeTotal) {
		throw new Error('Category allocations cannot exceed total savings.')
	}
	return funds
}

function renderSavingsCategoryAllocation() {
	if (!savingsCategoryListWrap || !entrySavingsRemainingOut) return
	ensureEntryAllocationCategories()
	const totalSavings = getCurrentSavingsDraftAmount()
	rebalanceEntryAllocationDraft(totalSavings)
	const categories = getAllSavingsCategories()
	const totalAllocated = getAllocatedSavingsAmount()
	const remaining = Math.max(0, totalSavings - totalAllocated)
	entrySavingsRemainingOut.textContent = `Remaining: ${formatDollars(remaining)}`

	if (!categories.length) {
		savingsCategoryListWrap.innerHTML = '<div class="breakdown-empty">Add a savings category to start allocating.</div>'
		return
	}

	savingsCategoryListWrap.innerHTML = categories.map((category, index) => {
		const current = Math.max(0, Math.round(Number(entrySavingsAllocationDraft[category]) || 0))
		const allocatedOthers = totalAllocated - current
		const maxForCategory = Math.max(0, totalSavings - allocatedOthers)
		const canRemove = !DEFAULT_FUND_NAMES.includes(category)
		return `<div class="allocation-row">
			<div class="allocation-row-head">
				<strong>${escapeHtml(category)}</strong>
				<span>${formatDollars(current)}</span>
			</div>
			<input class="range allocation-range" type="range" data-category-index="${index}" min="0" max="${maxForCategory}" step="1" value="${Math.min(current, maxForCategory)}" aria-label="${escapeHtml(category)} allocation" />
			<div class="allocation-row-controls">
				<input class="auth-input" data-category-amount-index="${index}" type="number" inputmode="numeric" min="0" max="${maxForCategory}" step="1" value="${Math.min(current, maxForCategory)}" aria-label="${escapeHtml(category)} amount" />
				${canRemove ? `<button class="auth-btn auth-btn--secondary" type="button" data-remove-category-index="${index}">Remove</button>` : ''}
			</div>
		</div>`
	}).join('')
}

function createDefaultProfileSettings() {
	const startMs = startOfLocalDayMs(new Date())
	const endMs = addYearsMs(startMs, PROGRAM_YEARS)
	return {
		name: '',
		email: '',
		contactInfo: '',
		goalStartDate: isoDateValue(startMs),
		goalEndDate: isoDateValue(endMs),
		goodAt: '',
		enjoys: '',
		strengths: '',
		weaknesses: '',
	}
}

function sanitizeProfileSettings(value) {
	const base = createDefaultProfileSettings()
	const next = {
		name: sanitizeShortText(value?.name || '', 120),
		email: sanitizeShortText(value?.email || '', 160),
		contactInfo: sanitizeLongText(value?.contactInfo || '', 320),
		goalStartDate: String(value?.goalStartDate || base.goalStartDate).trim() || base.goalStartDate,
		goalEndDate: String(value?.goalEndDate || base.goalEndDate).trim() || base.goalEndDate,
		goodAt: sanitizeLongText(value?.goodAt || '', 500),
		enjoys: sanitizeLongText(value?.enjoys || '', 500),
		strengths: sanitizeLongText(value?.strengths || '', 500),
		weaknesses: sanitizeLongText(value?.weaknesses || '', 500),
	}
	const startMs = parseDateInputToDayMs(next.goalStartDate)
	const endMs = parseDateInputToDayMs(next.goalEndDate)
	if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
		next.goalStartDate = base.goalStartDate
		next.goalEndDate = base.goalEndDate
	}
	return next
}

function createDefaultHabitBoardState() {
	return createEmptyHabitBoardState()
}

function createEmptyHabitBox(index = 0) {
	return {
		id: `habit-box-${index + 1}`,
		title: index === 0 ? 'Habit board' : `Habit box ${index + 1}`,
		description: 'Add squares to define the habits you want to track.',
		checks: [],
		items: [],
	}
}

function createEmptyHabitBoardState() {
	return {
		items: [],
		boxes: [createEmptyHabitBox(0)],
		weeksByKey: {},
	}
}

function createDefaultHabitSquare(index = 0, source = {}) {
	return {
		id: sanitizeShortText(source?.id || `habit-square-${index + 1}`, 80),
		icon: sanitizeShortText(source?.icon || String(index + 1), 10),
		title: sanitizeShortText(source?.title || `Square ${index + 1}`, 60),
		description: sanitizeLongText(source?.description || 'Describe what completing this square means.', 180),
	}
}

function createDefaultHabitBox(index = 0, sourceItems = []) {
	const fallbackItems = Array.isArray(sourceItems) && sourceItems.length ? sourceItems : [
		{ icon: '1', title: 'Square 1', description: 'Describe what completing this square means.' },
		{ icon: '2', title: 'Square 2', description: 'Describe what completing this square means.' },
		{ icon: '3', title: 'Square 3', description: 'Describe what completing this square means.' },
		{ icon: '4', title: 'Square 4', description: 'Describe what completing this square means.' },
	]
	return {
		id: `habit-box-${index + 1}`,
		title: index === 0 ? 'Habit board' : `Habit box ${index + 1}`,
		description: 'Click a square when you complete it, then use the ledger to define what it means.',
		checks: [false, false, false, false],
		items: new Array(4).fill(null).map((_, itemIndex) => createDefaultHabitSquare(itemIndex, fallbackItems[itemIndex] || {})),
	}
}

function sanitizeHabitBoardState(value) {
	const base = createEmptyHabitBoardState()
	const rawItems = Array.isArray(value?.items) ? value.items.slice(0, 4) : []
	const items = base.items.map((item, index) => {
		const next = rawItems[index] || item
		return {
			id: item.id,
			icon: sanitizeShortText(next?.icon || item.icon, 10),
			title: sanitizeShortText(next?.title || item.title, 60),
			description: sanitizeLongText(next?.description || item.description, 180),
		}
	})
	const rawBoxes = Array.isArray(value?.boxes) && value.boxes.length
		? value.boxes.slice(0, 24)
		: []
	const flattenedSquares = []
	const flattenedChecks = []
	for (const [boxIndex, boxValue] of rawBoxes.entries()) {
		const fallbackBox = createDefaultHabitBox(boxIndex, items)
		const rawBoxItems = Array.isArray(boxValue?.items) && boxValue.items.length ? boxValue.items.slice(0, 24) : fallbackBox.items
		const rawChecks = Array.isArray(boxValue?.checks) ? boxValue.checks.map(Boolean) : fallbackBox.checks
		for (let itemIndex = 0; itemIndex < rawBoxItems.length; itemIndex += 1) {
			flattenedSquares.push(createDefaultHabitSquare(flattenedSquares.length, rawBoxItems[itemIndex] || fallbackBox.items[itemIndex] || {}))
			flattenedChecks.push(Boolean(rawChecks[itemIndex]))
		}
	}
	const mergedSquares = flattenedSquares.length ? flattenedSquares.slice(0, 24) : items.map((item, index) => createDefaultHabitSquare(index, item))
	const mergedChecks = mergedSquares.map((_, index) => Boolean(flattenedChecks[index]))
	const primaryBox = rawBoxes[0] || createEmptyHabitBox(0)
	const legacyItems = mergedSquares.slice(0, 4).map((item, index) => ({
		id: `habit-${index + 1}`,
		icon: sanitizeShortText(item?.icon || String(index + 1), 10),
		title: sanitizeShortText(item?.title || `Square ${index + 1}`, 60),
		description: sanitizeLongText(item?.description || 'Describe what completing this square means.', 180),
	}))
	const boxes = [{
		id: sanitizeShortText(primaryBox?.id || 'habit-board-1', 80) || 'habit-board-1',
		title: sanitizeShortText(primaryBox?.title || 'Habit board', 80),
		description: sanitizeLongText(primaryBox?.description || 'Add squares to define the habits you want to track.', 200),
		checks: mergedChecks,
		items: mergedSquares,
	}]
	const weeksByKey = {}
	for (const [weekKey, weekValue] of Object.entries(value?.weeksByKey || {})) {
		const safeWeekKey = sanitizeDateString(weekKey, startOfLocalWeekMs(new Date()))
		const rawDays = Array.isArray(weekValue?.days) ? weekValue.days.slice(0, 7) : []
		weeksByKey[safeWeekKey] = {
			days: new Array(7).fill(null).map((_, index) => {
				const day = rawDays[index] || {}
				const checks = createHabitChecksArray(mergedSquares.length || 4, day?.checks)
				return {
					did: sanitizeLongText(day?.did || '', 240),
					didWell: sanitizeLongText(day?.didWell || '', 240),
					couldDoBetter: sanitizeLongText(day?.couldDoBetter || '', 240),
					checks,
					isStarred: Boolean(day?.isStarred),
					starredNote: '',
				}
			}),
		}
	}
	return { items: legacyItems, boxes, weeksByKey }
}

function sanitizeWeeklyReportEntry(value) {
	const starredSections = sanitizeStarredSections(value?.starredSections, WEEKLY_STAR_KEYS)
	if (!hasActiveStarredSections(starredSections) && value?.isStarred) {
		starredSections.lessons = {
			active: true,
			note: '',
		}
	}
	return {
		week: sanitizeDateString(value?.week, startOfLocalWeekMs(new Date())),
		meetingWho1: sanitizeShortText(value?.meetingWho1 || '', 120),
		meetingLearned1: sanitizeLongText(value?.meetingLearned1 || '', 240),
		meetingWho2: sanitizeShortText(value?.meetingWho2 || '', 120),
		meetingLearned2: sanitizeLongText(value?.meetingLearned2 || '', 240),
		book1: sanitizeShortText(value?.book1 || '', 120),
		book1Chapter: sanitizeShortText(value?.book1Chapter || '', 60),
		book1Learned: sanitizeLongText(value?.book1Learned || '', 240),
		book2: sanitizeShortText(value?.book2 || '', 120),
		book2Chapter: sanitizeShortText(value?.book2Chapter || '', 60),
		book2Learned: sanitizeLongText(value?.book2Learned || '', 240),
		lessonTitle1: sanitizeShortText(value?.lessonTitle1 || '', 120),
		lessonLearned1: sanitizeLongText(value?.lessonLearned1 || '', 240),
		lessonTitle2: sanitizeShortText(value?.lessonTitle2 || '', 120),
		lessonLearned2: sanitizeLongText(value?.lessonLearned2 || '', 240),
		incomeJob1: Math.max(0, Math.round(Number(value?.incomeJob1) || 0)),
		incomeJob2: Math.max(0, Math.round(Number(value?.incomeJob2) || 0)),
		expenses: Math.max(0, Math.round(Number(value?.expenses) || 0)),
		isStarred: hasActiveStarredSections(starredSections) || Boolean(value?.isStarred),
		starredNote: '',
		starredSections,
	}
}

function sanitizeJournalEntry(value) {
	const own = Math.max(0, Math.round(Number(value?.own) || 0))
	const owe = Math.max(0, Math.round(Number(value?.owe) || 0))
	const starredSections = sanitizeStarredSections(value?.starredSections, JOURNAL_STAR_KEYS)
	if (!hasActiveStarredSections(starredSections) && value?.isStarred) {
		starredSections.financial = {
			active: true,
			note: '',
		}
	}
	return {
		month: sanitizeDateString(value?.month, startOfLocalMonthMs(new Date())),
		own,
		owe,
		financialProgress: sanitizeLongText(value?.financialProgress || '', 200),
		aheadBehind: sanitizeShortText(value?.aheadBehind || '', 60),
		goalThisMonth: sanitizeLongText(value?.goalThisMonth || '', 240),
		primaryJob: sanitizeShortText(value?.primaryJob || '', 120),
		secondaryJob: sanitizeShortText(value?.secondaryJob || '', 120),
		volunteerOpportunities: sanitizeLongText(value?.volunteerOpportunities || '', 240),
		reading: sanitizeLongText(value?.reading || '', 240),
		meetings: sanitizeLongText(value?.meetings || '', 240),
		classes: sanitizeLongText(value?.classes || '', 240),
		billingJob: sanitizeLongText(value?.billingJob || '', 240),
		interests: sanitizeLongText(value?.interests || '', 240),
		enjoying: sanitizeLongText(value?.enjoying || '', 240),
		helpPeople: sanitizeLongText(value?.helpPeople || '', 240),
		isStarred: hasActiveStarredSections(starredSections) || Boolean(value?.isStarred),
		starredNote: '',
		starredSections,
	}
}

function getCurrentJournalEntry() {
	const currentMonth = getCurrentMonthIso()
	return journalEntries.find((entry) => entry.month === currentMonth) || sanitizeJournalEntry({ month: currentMonth })
}

const FREEDOM_FIVES = [
	'Financial Freedom',
	'Intellectual Freedom',
	'Vocational Freedom',
	'Emotional Freedom',
	'Spiritual Freedom',
	'Other / Random Thoughts',
]

function sanitizeFreedomJournalEntry(value) {
	const freedomFive = FREEDOM_FIVES.includes(value?.freedomFive) ? value.freedomFive : FREEDOM_FIVES[0]
	return {
		id: sanitizeShortText(value?.id || '', 80),
		freedomFive,
		title: sanitizeShortText(value?.title || '', 120),
		reflection: sanitizeLongText(value?.reflection || '', 2000),
		isFavorite: Boolean(value?.isFavorite),
		createdAtMs: Math.max(0, Math.round(Number(value?.createdAtMs) || Date.now())),
	}
}

function getCurrentWeeklyReportEntry() {
	const currentWeek = getCurrentWeekIso()
	return weeklyReports.find((entry) => entry.week === currentWeek) || sanitizeWeeklyReportEntry({ week: currentWeek })
}

function getStarredHighlights() {
	/** @type {Array<{ kind: string, label: string, note: string, summary: string }>} */
	const highlights = []
	for (const entry of journalEntries) {
		if (entry.starredSections?.financial?.active) highlights.push({ kind: 'Month', label: `${formatMonthHeading(entry.month)} · Financial`, note: '', summary: entry.goalThisMonth || entry.financialProgress || entry.aheadBehind })
		if (entry.starredSections?.jobs?.active) highlights.push({ kind: 'Month', label: `${formatMonthHeading(entry.month)} · Jobs`, note: '', summary: [entry.primaryJob, entry.secondaryJob, entry.volunteerOpportunities].filter(Boolean).join('\n') })
		if (entry.starredSections?.lessons?.active) highlights.push({ kind: 'Month', label: `${formatMonthHeading(entry.month)} · Lessons`, note: '', summary: [entry.reading, entry.meetings, entry.classes].filter(Boolean).join('\n') })
		if (entry.starredSections?.meaningfulWork?.active) highlights.push({ kind: 'Month', label: `${formatMonthHeading(entry.month)} · Meaningful Work`, note: '', summary: [entry.billingJob, entry.interests, entry.enjoying, entry.helpPeople].filter(Boolean).join('\n') })
	}
	for (const entry of freedomJournalEntries) {
		if (entry.isFavorite) highlights.push({ kind: 'Journal', label: entry.title || formatDateLabel(entry.createdAtMs), note: entry.freedomFive, summary: entry.reflection })
	}
	for (const entry of weeklyReports) {
		if (entry.starredSections?.meetings?.active) highlights.push({ kind: 'Week', label: `Week of ${formatDateLabel(entry.week)} · Meetings`, note: '', summary: [entry.meetingWho1 && `Who: ${entry.meetingWho1}`, entry.meetingLearned1, entry.meetingWho2 && `Who: ${entry.meetingWho2}`, entry.meetingLearned2].filter(Boolean).join('\n') })
		if (entry.starredSections?.books?.active) highlights.push({ kind: 'Week', label: `Week of ${formatDateLabel(entry.week)} · Books`, note: '', summary: [entry.book1 && `${entry.book1} (${entry.book1Chapter})`, entry.book1Learned, entry.book2 && `${entry.book2} (${entry.book2Chapter})`, entry.book2Learned].filter(Boolean).join('\n') })
		if (entry.starredSections?.lessons?.active) highlights.push({ kind: 'Week', label: `Week of ${formatDateLabel(entry.week)} · Lessons`, note: '', summary: [entry.lessonTitle1 && `${entry.lessonTitle1}: ${entry.lessonLearned1}`, entry.lessonTitle2 && `${entry.lessonTitle2}: ${entry.lessonLearned2}`].filter(Boolean).join('\n') })
		if (entry.starredSections?.finances?.active) highlights.push({ kind: 'Week', label: `Week of ${formatDateLabel(entry.week)} · Finances`, note: '', summary: `Income ${formatDollars(entry.incomeJob1 + entry.incomeJob2)} · Expenses ${formatDollars(entry.expenses)} · Margin ${formatSignedDollars(entry.incomeJob1 + entry.incomeJob2 - entry.expenses)}` })
	}
	const safeBoard = sanitizeHabitBoardState(habitBoardState)
	for (const [weekKey, weekValue] of Object.entries(safeBoard.weeksByKey || {})) {
		weekValue.days.forEach((day, index) => {
			if (!day.isStarred) return
			const dayMs = startOfLocalWeekMs(new Date(weekKey)) + index * DAY_MS
			highlights.push({ kind: 'Day', label: formatDateLabel(dayMs), note: '', summary: day.didWell || day.did || day.couldDoBetter })
		})
	}
	return highlights.sort((a, b) => b.label.localeCompare(a.label))
}

function sanitizeLedgerEntryMeta(value) {
	const funds = {
		'E-Fund': Math.max(0, Math.round(Number(value?.funds?.['E-Fund']) || 0)),
		'Car Fund': Math.max(0, Math.round(Number(value?.funds?.['Car Fund']) || 0)),
		'Next Big Fund': Math.max(0, Math.round(Number(value?.funds?.['Next Big Fund']) || 0)),
	}
	const incomeAllocations = {}
	for (const [name, amount] of Object.entries(value?.incomeAllocations || {})) {
		const safeName = sanitizeShortText(name, 60)
		const safeAmount = Math.max(0, Math.round(Number(amount) || 0))
		if (!safeName || safeAmount <= 0) continue
		incomeAllocations[safeName] = safeAmount
	}
	const expenseAllocations = {}
	for (const [name, amount] of Object.entries(value?.expenseAllocations || {})) {
		const safeName = sanitizeShortText(name, 60)
		const safeAmount = Math.max(0, Math.round(Number(amount) || 0))
		if (!safeName || safeAmount <= 0) continue
		expenseAllocations[safeName] = safeAmount
	}
	for (const [fundName, amount] of Object.entries(value?.funds || {})) {
		const safeFundName = normalizeFundName(fundName)
		if (!safeFundName || DEFAULT_FUND_NAMES.includes(safeFundName)) continue
		funds[safeFundName] = Math.max(0, Math.round(Number(amount) || 0))
	}
	const safeExpenseCategory = sanitizeShortText(value?.expenseCategory || 'Other', 60) || 'Other'
	const allowedExpenseCategories = new Set(getAllExpenseCategories().map((item) => item.toLowerCase()))
	return {
		incomeSource: sanitizeShortText(value?.incomeSource || '', 120),
		incomeNote: sanitizeLongText(value?.incomeNote || '', 240),
		expenseCategory: allowedExpenseCategories.has(safeExpenseCategory.toLowerCase()) ? safeExpenseCategory : 'Other',
		expenseNote: sanitizeLongText(value?.expenseNote || '', 240),
		incomeAllocations,
		expenseAllocations,
		funds,
	}
}

async function loadUserScopedAppState() {
	if (!session) {
		profileSettings = createDefaultProfileSettings()
		habitBoardState = createDefaultHabitBoardState()
		weeklyReports = []
		journalEntries = []
		ledgerEntryMetaByClientId = {}
		savingsLogEntries = []
		customSavingsCategories = []
		customExpenseCategories = []
		customIncomeCategories = []
		collapsibleUiState = sanitizeCollapsibleUiState(loadScopedJson(COLLAPSIBLE_UI_STORAGE_PREFIX, {}))
		entrySavingsAllocationDraft = {}
		accountNotifications = []
		instructorStudentEmails = []
		instructorDashboardState = { role: 'student', instructors: [], students: [] }
		return
	}
	const loadedSettings = loadScopedJson(PROFILE_SETTINGS_STORAGE_PREFIX, createDefaultProfileSettings())
	profileSettings = sanitizeProfileSettings({
		...loadedSettings,
		name: loadedSettings?.name || session?.name || '',
		email: loadedSettings?.email || session?.email || '',
	})
	habitBoardState = sanitizeHabitBoardState(loadScopedJson(HABIT_BOARD_STORAGE_PREFIX, createDefaultHabitBoardState()))
	weeklyReports = loadScopedArray(WEEKLY_REPORT_STORAGE_PREFIX).map(sanitizeWeeklyReportEntry).sort((a, b) => b.week.localeCompare(a.week))
	journalEntries = loadScopedArray(JOURNAL_STORAGE_PREFIX).map(sanitizeJournalEntry).sort((a, b) => b.month.localeCompare(a.month))
	freedomJournalEntries = loadScopedArray(FREEDOM_JOURNAL_STORAGE_PREFIX).map(sanitizeFreedomJournalEntry).sort((a, b) => b.createdAtMs - a.createdAtMs)
	const meta = loadScopedJson(LEDGER_META_STORAGE_PREFIX, {})
	ledgerEntryMetaByClientId = Object.fromEntries(
		Object.entries(meta || {}).map(([clientId, entryMeta]) => [clientId, sanitizeLedgerEntryMeta(entryMeta)])
	)
	customSavingsCategories = sanitizeSavingsCategoryList(loadScopedArray(SAVINGS_CATEGORY_STORAGE_PREFIX))
	customExpenseCategories = sanitizeExpenseCategoryList(loadScopedArray(EXPENSE_CATEGORY_STORAGE_PREFIX))
	customIncomeCategories = sanitizeIncomeCategoryList(loadScopedArray(INCOME_CATEGORY_STORAGE_PREFIX))
	collapsibleUiState = sanitizeCollapsibleUiState(loadScopedJson(COLLAPSIBLE_UI_STORAGE_PREFIX, {}))
	entrySavingsAllocationDraft = {}
	savingsLogEntries = loadScopedArray(SAVINGS_LOG_STORAGE_PREFIX)
		.map((entry) => ({ month: Number(entry?.month), dollars: Math.max(0, Math.round(Number(entry?.dollars) || 0)) }))
		.filter((entry) => Number.isFinite(entry.month) && entry.month > 0)
		.sort((a, b) => a.month - b.month)
}

function saveProfileSettingsToStorage(nextSettings, { persistRendererState = true } = {}) {
	profileSettings = sanitizeProfileSettings(nextSettings)
	saveScopedJson(PROFILE_SETTINGS_STORAGE_PREFIX, profileSettings)
	if (persistRendererState) void persistDesktopRendererState()
}

function saveHabitBoardToStorage(nextHabitBoardState) {
	habitBoardState = sanitizeHabitBoardState(nextHabitBoardState)
	saveScopedJson(HABIT_BOARD_STORAGE_PREFIX, habitBoardState)
	renderStarredHighlights()
	void persistDesktopRendererState()
}

function saveWeeklyReportsToStorage(nextWeeklyReports) {
	weeklyReports = (Array.isArray(nextWeeklyReports) ? nextWeeklyReports : []).map(sanitizeWeeklyReportEntry).sort((a, b) => b.week.localeCompare(a.week))
	saveScopedJson(WEEKLY_REPORT_STORAGE_PREFIX, weeklyReports)
	renderStarredHighlights()
	void persistDesktopRendererState()
}

function saveJournalEntriesToStorage(nextJournalEntries) {
	journalEntries = (Array.isArray(nextJournalEntries) ? nextJournalEntries : []).map(sanitizeJournalEntry).sort((a, b) => b.month.localeCompare(a.month))
	saveScopedJson(JOURNAL_STORAGE_PREFIX, journalEntries)
	renderStarredHighlights()
	void persistDesktopRendererState()
}

function saveFreedomJournalEntriesToStorage(nextEntries) {
	freedomJournalEntries = (Array.isArray(nextEntries) ? nextEntries : []).map(sanitizeFreedomJournalEntry).sort((a, b) => b.createdAtMs - a.createdAtMs)
	saveScopedJson(FREEDOM_JOURNAL_STORAGE_PREFIX, freedomJournalEntries)
	renderStarredHighlights()
	void persistDesktopRendererState()
}

function saveLedgerEntryMetaToStorage() {
	saveScopedJson(LEDGER_META_STORAGE_PREFIX, ledgerEntryMetaByClientId)
	void persistDesktopRendererState()
}

function saveSavingsCategoriesToStorage(nextCategories) {
	customSavingsCategories = sanitizeSavingsCategoryList(nextCategories)
	saveScopedJson(SAVINGS_CATEGORY_STORAGE_PREFIX, customSavingsCategories)
	void persistDesktopRendererState()
}

function saveExpenseCategoriesToStorage(nextCategories) {
	customExpenseCategories = sanitizeExpenseCategoryList(nextCategories)
	saveScopedJson(EXPENSE_CATEGORY_STORAGE_PREFIX, customExpenseCategories)
	void persistDesktopRendererState()
}

function saveIncomeCategoriesToStorage(nextCategories) {
	customIncomeCategories = sanitizeIncomeCategoryList(nextCategories)
	saveScopedJson(INCOME_CATEGORY_STORAGE_PREFIX, customIncomeCategories)
	void persistDesktopRendererState()
}

function saveSavingsLogEntriesToStorage(nextSavingsLogEntries) {
	savingsLogEntries = (Array.isArray(nextSavingsLogEntries) ? nextSavingsLogEntries : [])
		.map((entry) => ({ month: Number(entry?.month), dollars: Math.max(0, Math.round(Number(entry?.dollars) || 0)) }))
		.filter((entry) => Number.isFinite(entry.month) && entry.month > 0)
		.sort((a, b) => a.month - b.month)
	saveScopedJson(SAVINGS_LOG_STORAGE_PREFIX, savingsLogEntries)
	void persistDesktopRendererState()
}

function getLedgerEntryMeta(clientId) {
	if (!clientId) return sanitizeLedgerEntryMeta({})
	return sanitizeLedgerEntryMeta(ledgerEntryMetaByClientId[clientId] || {})
}

function setLedgerEntryMeta(clientId, meta) {
	if (!clientId) return
	ledgerEntryMetaByClientId[clientId] = sanitizeLedgerEntryMeta(meta)
	saveLedgerEntryMetaToStorage()
}

function makeClientId() {
	try {
		const cryptoObj = /** @type {any} */ (globalThis?.crypto)
		if (cryptoObj?.randomUUID) return String(cryptoObj.randomUUID())
	} catch {
		// ignore
	}
	return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function getLedgerCloudSyncKeyFor(userKey) {
	const normalized = String(userKey || '').trim().toLowerCase()
	return `${LEDGER_CLOUD_SYNC_PREFIX}${normalized || 'anonymous'}`
}

function getLedgerCloudSyncKey() {
	return getLedgerCloudSyncKeyFor(session?.cloudUserId || session?.email || '')
}

function loadLedgerCloudSyncState() {
	try {
		const primaryKey = getLedgerCloudSyncKey()
		let raw = localStorage.getItem(primaryKey)

		// Migration: older desktop sessions didn’t have `cloudUserId`, so the key
		// would have been based on `email`. If we now have a cloudUserId key but
		// it doesn't exist yet, carry over the legacy state.
		const legacyEmailKey = session?.cloudUserId && session?.email ? getLedgerCloudSyncKeyFor(session.email) : ''
		if (!raw && legacyEmailKey && legacyEmailKey !== primaryKey) {
			const legacyRaw = localStorage.getItem(legacyEmailKey)
			if (legacyRaw) {
				raw = legacyRaw
				try {
					localStorage.setItem(primaryKey, legacyRaw)
					localStorage.removeItem(legacyEmailKey)
				} catch {
					// ignore
				}
			}
		}

		if (!raw) return { pendingClientIds: [], lastPullMs: 0 }

		const parsed = JSON.parse(raw)
		const pending = Array.isArray(parsed?.pendingClientIds) ? parsed.pendingClientIds.filter((x) => typeof x === 'string' && x.trim()) : []
		const lastPullMs = Number(parsed?.lastPullMs)
		return {
			pendingClientIds: [...new Set(pending)],
			lastPullMs: Number.isFinite(lastPullMs) && lastPullMs > 0 ? lastPullMs : 0,
		}
	} catch {
		return { pendingClientIds: [], lastPullMs: 0 }
	}
}

function saveLedgerCloudSyncState(state) {
	try {
		localStorage.setItem(getLedgerCloudSyncKey(), JSON.stringify(state))
	} catch {
		// ignore
	}
}

function enqueueLedgerForCloudSync(clientId) {
	if (!clientId) return
	const state = loadLedgerCloudSyncState()
	if (!state.pendingClientIds.includes(clientId)) {
		state.pendingClientIds.push(clientId)
		saveLedgerCloudSyncState(state)
	}
}

function dequeueLedgerCloudSync(clientId) {
	if (!clientId) return
	const state = loadLedgerCloudSyncState()
	const next = state.pendingClientIds.filter((x) => x !== clientId)
	if (next.length === state.pendingClientIds.length) return
	state.pendingClientIds = next
	saveLedgerCloudSyncState(state)
}

function startOfLocalDayMs(date) {
	const d = new Date(date)
	d.setHours(0, 0, 0, 0)
	return d.getTime()
}

function isoDateValue(ms) {
	const d = new Date(ms)
	const y = d.getFullYear()
	const m = String(d.getMonth() + 1).padStart(2, '0')
	const day = String(d.getDate()).padStart(2, '0')
	return `${y}-${m}-${day}`
}

function parseDateInputToDayMs(value) {
	const raw = String(value || '').trim()
	if (!raw) return startOfLocalDayMs(new Date())
	const [y, m, d] = raw.split('-').map((x) => Number(x))
	if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return startOfLocalDayMs(new Date())
	return startOfLocalDayMs(new Date(y, m - 1, d))
}

function getLedgerStorageKey() {
	const email = String(session?.email || '').trim().toLowerCase()
	return `${LEDGER_STORAGE_PREFIX}${email || 'anonymous'}`
}

function loadLedgerFromLocalStorage() {
	try {
		const raw = localStorage.getItem(getLedgerStorageKey())
		if (!raw) return []
		const data = JSON.parse(raw)
		if (!Array.isArray(data)) return []

		let changed = false
		const cleaned = data
			.map((e) => {
				let clientId = typeof e?.clientId === 'string' ? e.clientId.trim() : ''
				if (!clientId) {
					clientId = makeClientId()
					changed = true
				}
				return {
					id: e?.id ?? clientId,
					clientId,
					dayMs: Number(e?.dayMs),
					incomeDollars: Number(e?.incomeDollars) || 0,
					expensesDollars: Number(e?.expensesDollars) || 0,
					savingsDollars: Number(e?.savingsDollars) || 0,
				}
			})
			.filter((e) => Number.isFinite(e.dayMs) && e.dayMs > 0)
			.sort((a, b) => a.dayMs - b.dayMs)

		if (changed) {
			ledgerEntries = cleaned
			saveLedgerToLocalStorage()
		}
		return cleaned
	} catch {
		return []
	}
}

function saveLedgerToLocalStorage() {
	try {
		localStorage.setItem(getLedgerStorageKey(), JSON.stringify(ledgerEntries))
	} catch {
		// ignore
	}
}

async function loadLedgerEntriesFromDesktop() {
	if (!isDesktopApp) return
	if (!session) {
		ledgerEntries = []
		return
	}
	try {
		const rows = await desktop.ledger.listEntries()
		ledgerEntries = Array.isArray(rows)
			? rows
				.map((r) => ({
					id: r?.id ?? 0,
					clientId: typeof r?.clientId === 'string' ? r.clientId : `legacy-${r?.id ?? 0}`,
					dayMs: Number(r?.dayMs),
					incomeDollars: Number(r?.incomeDollars) || 0,
					expensesDollars: Number(r?.expensesDollars) || 0,
					savingsDollars: Number(r?.savingsDollars) || 0,
				}))
				.filter((e) => Number.isFinite(e.dayMs) && e.dayMs > 0)
				.sort((a, b) => a.dayMs - b.dayMs)
			: []
	} catch {
		ledgerEntries = []
	}
}

async function loadSavingsLogEntriesFromDesktop() {
	if (!isDesktopApp) return
	if (!session) {
		savingsLogEntries = []
		return
	}
	try {
		const rows = await desktop.savings.getLog()
		saveSavingsLogEntriesToStorage(Array.isArray(rows) ? rows : [])
	} catch {
		savingsLogEntries = []
	}
}

function mergeSavingsSnapshot(monthMs, dollars) {
	const safeMonthMs = Math.round(Number(monthMs) || 0)
	const safeDollars = Math.max(0, Math.round(Number(dollars) || 0))
	if (!Number.isFinite(safeMonthMs) || safeMonthMs <= 0) return
	const next = savingsLogEntries.slice()
	const index = next.findIndex((entry) => Number(entry?.month) === safeMonthMs)
	if (index >= 0) next[index] = { month: safeMonthMs, dollars: safeDollars }
	else next.push({ month: safeMonthMs, dollars: safeDollars })
	saveSavingsLogEntriesToStorage(next)
}

async function syncCurrentSavingsSnapshotFromLedger() {
	if (!session) return
	const currentDollars = sumLedgerSavingsSince(getGoalTimeline().startMs)
	const monthMs = startOfLocalMonthMs(new Date())
	mergeSavingsSnapshot(monthMs, currentDollars)
	if (isDesktopApp && desktop?.savings?.upsertMonth) {
		try {
			await desktop.savings.upsertMonth(monthMs, currentDollars)
		} catch {
			// ignore snapshot sync failures; ledger save already succeeded
		}
	}
}

async function loadLedgerEntriesFromStorage() {
	if (!session) {
		ledgerEntries = []
		return
	}
	if (isDesktopApp) {
		await loadLedgerEntriesFromDesktop()
		return
	}
	ledgerEntries = loadLedgerFromLocalStorage()
}

function upsertLedgerEntryInMemory(entry) {
	if (!entry?.clientId) return
	const idx = ledgerEntries.findIndex((e) => e.clientId === entry.clientId)
	if (idx >= 0) ledgerEntries[idx] = { ...ledgerEntries[idx], ...entry }
	else ledgerEntries.push(entry)
	ledgerEntries.sort((a, b) => a.dayMs - b.dayMs)
}

async function upsertLedgerEntryLocally(entry) {
	if (!session) return
	if (!entry?.clientId) return

	if (isDesktopApp) {
		try {
			const out = await desktop.ledger.addEntry({
				clientId: entry.clientId,
				dayMs: entry.dayMs,
				incomeDollars: entry.incomeDollars,
				expensesDollars: entry.expensesDollars,
				savingsDollars: entry.savingsDollars,
				createdAtMs: entry.createdAtMs,
				updatedAtMs: entry.updatedAtMs,
			})
			const id = Number(out?.id)
			upsertLedgerEntryInMemory({ ...entry, id: Number.isFinite(id) && id > 0 ? id : entry.id })
		} catch {
			// ignore
		}
		return
	}

	upsertLedgerEntryInMemory(entry)
	saveLedgerToLocalStorage()
}

async function cloudLedgerPull({ token, sinceMs }) {
	return apiJson({ method: 'GET', apiPath: LEDGER_CLOUD_PULL_PATH, token, query: { sinceMs } })
}

async function cloudLedgerUpsert({ token, entry }) {
	const meta = getLedgerEntryMeta(entry?.clientId)
	return apiJson({
		method: 'POST',
		apiPath: LEDGER_CLOUD_UPSERT_PATH,
		token,
		body: {
			clientId: entry.clientId,
			dayMs: entry.dayMs,
			incomeDollars: entry.incomeDollars,
			expensesDollars: entry.expensesDollars,
			savingsDollars: entry.savingsDollars,
			incomeSource: meta.incomeSource,
			incomeNote: meta.incomeNote,
			expenseCategory: meta.expenseCategory,
			expenseNote: meta.expenseNote,
			incomeAllocations: meta.incomeAllocations,
			expenseAllocations: meta.expenseAllocations,
			funds: meta.funds,
			createdAtMs: entry.createdAtMs,
			updatedAtMs: entry.updatedAtMs,
		},
	})
}

let ledgerCloudSyncInFlight = false
async function syncLedgerWithCloud() {
	if (!session?.token) return
	if (!session) return
	if (ledgerCloudSyncInFlight) return
	ledgerCloudSyncInFlight = true

	try {
		const state = loadLedgerCloudSyncState()
		let maxSeen = state.lastPullMs || 0
		const pendingLocalIds = new Set(Array.isArray(state.pendingClientIds) ? state.pendingClientIds : [])

		try {
			const out = await cloudLedgerPull({ token: session.token, sinceMs: state.lastPullMs || 0 })
			const items = Array.isArray(out?.items) ? out.items : []
			for (const item of items) {
				const clientId = typeof item?.clientId === 'string' ? item.clientId.trim() : ''
				const dayMs = Number(item?.dayMs)
				const incomeDollars = Math.max(0, Math.round(Number(item?.incomeDollars) || 0))
				const expensesDollars = Math.max(0, Math.round(Number(item?.expensesDollars) || 0))
				const savingsDollars = Math.max(0, Math.round(Number(item?.savingsDollars) || 0))
				const updatedAtMs = Number(item?.updatedAtMs)
				const createdAtMs = Number(item?.createdAtMs)

				if (!clientId) continue
				if (!Number.isFinite(dayMs) || dayMs <= 0) continue
				if (Number.isFinite(updatedAtMs) && updatedAtMs > maxSeen) maxSeen = updatedAtMs
				if (pendingLocalIds.has(clientId)) continue
				const localEntry = ledgerEntries.find((e) => e.clientId === clientId)
				const localUpdatedAtMs = Number(localEntry?.updatedAtMs)
				if (Number.isFinite(updatedAtMs) && Number.isFinite(localUpdatedAtMs) && localUpdatedAtMs > updatedAtMs) {
					continue
				}
				if (!Number.isFinite(updatedAtMs) && Number.isFinite(localUpdatedAtMs) && localUpdatedAtMs > 0) {
					continue
				}
				const priorMeta = getLedgerEntryMeta(clientId)
				setLedgerEntryMeta(clientId, {
					incomeSource: item?.incomeSource,
					incomeNote: item?.incomeNote,
					expenseCategory: item?.expenseCategory,
					expenseNote: item?.expenseNote,
					incomeAllocations: item?.incomeAllocations || priorMeta.incomeAllocations,
					expenseAllocations: item?.expenseAllocations || priorMeta.expenseAllocations,
					funds: item?.funds || priorMeta.funds,
				})
				await upsertLedgerEntryLocally({
					id: clientId,
					clientId,
					dayMs: Math.round(dayMs),
					incomeDollars,
					expensesDollars,
					savingsDollars,
					createdAtMs: Number.isFinite(createdAtMs) && createdAtMs > 0 ? Math.round(createdAtMs) : undefined,
					updatedAtMs: Number.isFinite(updatedAtMs) && updatedAtMs > 0 ? Math.round(updatedAtMs) : undefined,
				})
			}
		} catch (err) {
			warnWebSyncIfNeeded(err)
		}

		state.lastPullMs = maxSeen

		// Push pending local entries (cloud backup)
		const pending = Array.isArray(state.pendingClientIds) ? state.pendingClientIds.slice() : []
		/** @type {string[]} */
		const stillPending = []
		for (const clientId of pending) {
			const entry = ledgerEntries.find((e) => e.clientId === clientId)
			if (!entry) continue
			try {
				await cloudLedgerUpsert({ token: session.token, entry })
			} catch (err) {
				warnWebSyncIfNeeded(err)
				stillPending.push(clientId)
			}
		}
		state.pendingClientIds = stillPending
		saveLedgerCloudSyncState(state)
	} finally {
		ledgerCloudSyncInFlight = false
	}
}

async function addLedgerEntry({ dayMs, incomeDollars, expensesDollars, savingsDollars }) {
	if (!session) throw new Error('Not logged in')
	const now = Date.now()
	const entry = {
		id: '',
		clientId: makeClientId(),
		dayMs: Math.round(Number(dayMs)),
		incomeDollars: Math.max(0, Math.round(Number(incomeDollars) || 0)),
		expensesDollars: Math.max(0, Math.round(Number(expensesDollars) || 0)),
		savingsDollars: Math.max(0, Math.round(Number(savingsDollars) || 0)),
		createdAtMs: now,
		updatedAtMs: now,
	}
	entry.id = entry.clientId
	if (!Number.isFinite(entry.dayMs) || entry.dayMs <= 0) throw new Error('Invalid date')
	if (entry.incomeDollars <= 0 && entry.expensesDollars <= 0 && entry.savingsDollars <= 0) {
		throw new Error('Enter at least one amount')
	}

	if (isDesktopApp) {
		const out = await desktop.ledger.addEntry({
			clientId: entry.clientId,
			dayMs: entry.dayMs,
			incomeDollars: entry.incomeDollars,
			expensesDollars: entry.expensesDollars,
			savingsDollars: entry.savingsDollars,
			createdAtMs: entry.createdAtMs,
			updatedAtMs: entry.updatedAtMs,
		})
		const id = Number(out?.id)
		ledgerEntries.push({ ...entry, id: Number.isFinite(id) && id > 0 ? id : entry.id })
		ledgerEntries.sort((a, b) => a.dayMs - b.dayMs)
		await syncCurrentSavingsSnapshotFromLedger()
		enqueueLedgerForCloudSync(entry.clientId)
		void syncLedgerWithCloud()
		return entry
	}

	ledgerEntries.push(entry)
	ledgerEntries.sort((a, b) => a.dayMs - b.dayMs)
	saveLedgerToLocalStorage()
	await syncCurrentSavingsSnapshotFromLedger()
	enqueueLedgerForCloudSync(entry.clientId)
	void syncLedgerWithCloud()
	return entry
}

/** @type {null | { canvasW: number, canvasH: number, padL: number, padT: number, plotW: number, plotH: number, labels: string[], x: number[], series: Array<{ key: string, values: number[], points: Array<{ x: number, y: number, v: number }> }> }} */
let detailChartState = null

/** @type {'week' | 'month' | 'year'} */
let detailKind = 'week'

let detailAnchorDayMs = (() => {
	const d = new Date()
	d.setHours(0, 0, 0, 0)
	return d.getTime()
})()

/** @type {Array<{ id: number | string, clientId: string, dayMs: number, incomeDollars: number, expensesDollars: number, savingsDollars: number, createdAtMs?: number, updatedAtMs?: number }>} */
let ledgerEntries = []
let isGoalSliderLocked = false

if (authWrap) {
	authWrap.hidden = false
}

// Apply any locally saved goal immediately (web demo, or pre-login in desktop).
try {
	const savedGoalDollars = loadGoalDollarsFromLocalStorage()
	if (savedGoalDollars > 0) {
		const units = clamp(Math.round(savedGoalDollars / DOLLARS_PER_UNIT), MIN, MAX)
		range.value = String(units)
		setGoalSliderLocked(true)
	}
} catch {
	// ignore
}
updateGoalSliderUi()
// Optional logo override: if /logo.png exists (in public/), show it.
if (heroLogo) {
	heroLogo.addEventListener('load', () => {
		heroLogo.hidden = false
		if (heroMark) heroMark.hidden = true
	})
	heroLogo.addEventListener('error', () => {
		heroLogo.hidden = true
		if (heroMark) heroMark.hidden = false
	})
}

const homeSection = /** @type {HTMLElement} */ (document.querySelector('#home'))
const dashboardSection = /** @type {HTMLElement} */ (document.querySelector('#dashboard'))
const detailsSection = /** @type {HTMLElement} */ (document.querySelector('#details'))
const monthlyReportSection = /** @type {HTMLElement} */ (document.querySelector('#monthly-report'))
const journalSection = /** @type {HTMLElement} */ (document.querySelector('#journal'))
const weeklySection = /** @type {HTMLElement} */ (document.querySelector('#weekly'))
const starredSection = /** @type {HTMLElement} */ (document.querySelector('#starred'))
const habitsSection = /** @type {HTMLElement} */ (document.querySelector('#habits'))
const habitBoxesSection = /** @type {HTMLElement} */ (document.querySelector('#habit-boxes'))
const instructorSection = /** @type {HTMLElement} */ (document.querySelector('#instructor'))
const instructorStudentSection = /** @type {HTMLElement} */ (document.querySelector('#instructor-student'))
const superAdminSection = /** @type {HTMLElement} */ (document.querySelector('#super-admin'))
const settingsSection = /** @type {HTMLElement} */ (document.querySelector('#settings'))

function normalizeRoute(hash) {
	const raw = String(hash || '').replace(/^#/, '').trim().toLowerCase()
	const allowed = new Set(['home', 'dashboard', 'details', 'monthly-report', 'journal', 'weekly', 'starred', 'habits', 'habit-boxes', 'instructor', 'instructor-student', 'super-admin', 'settings'])
	return allowed.has(raw) ? raw : 'dashboard'
}

function renderRoute() {
	const route = normalizeRoute(location.hash)
	const needsAuth = route === 'details' || route === 'monthly-report' || route === 'journal' || route === 'weekly' || route === 'starred' || route === 'habits' || route === 'habit-boxes' || route === 'instructor' || route === 'instructor-student' || route === 'super-admin' || route === 'settings'
	const authed = Boolean(session)
	let target = needsAuth && !authed ? 'dashboard' : route
	if (target === 'instructor' && !isInstructorSession()) target = 'dashboard'
	if (target === 'instructor-student' && !isInstructorSession()) target = 'dashboard'
	if (target === 'super-admin' && !isSuperInstructorSession()) target = 'instructor'
	if (authed && isSuperInstructorSession() && target !== 'home' && target !== 'instructor' && target !== 'instructor-student' && target !== 'super-admin') target = 'instructor'

	if (homeSection) homeSection.hidden = target !== 'home'
	if (dashboardSection) dashboardSection.hidden = target !== 'dashboard'
	if (detailsSection) detailsSection.hidden = target !== 'details'
	if (monthlyReportSection) monthlyReportSection.hidden = target !== 'monthly-report'
	if (journalSection) journalSection.hidden = target !== 'journal'
	if (weeklySection) weeklySection.hidden = target !== 'weekly'
	if (starredSection) starredSection.hidden = target !== 'starred'
	if (habitsSection) habitsSection.hidden = target !== 'habits'
	if (habitBoxesSection) habitBoxesSection.hidden = target !== 'habit-boxes'
	if (instructorSection) instructorSection.hidden = target !== 'instructor'
	if (instructorStudentSection) instructorStudentSection.hidden = target !== 'instructor-student'
	if (superAdminSection) superAdminSection.hidden = target !== 'super-admin'
	if (settingsSection) settingsSection.hidden = target !== 'settings'

	// Ensure charts render when navigating to details.
	if (target === 'details') drawDetails()
	if (target === 'monthly-report') updateHabitTracker()
	if (target === 'journal') renderFreedomJournal()
	if (target === 'weekly') renderWeeklyReport()
	if (target === 'starred') renderStarredHighlights()
	if (target === 'habits') renderHabitBoard()
	if (target === 'habit-boxes') renderHabitBoxesPage()
	if (target === 'instructor') renderInstructorPanel()
	if (target === 'instructor-student') renderInstructorStudentPanel()
	if (target === 'super-admin') renderSuperAdminPanel()
	if (target === 'settings') renderSettingsPanel()
	if (target === 'dashboard') void refreshAccountFromCloud()

	// Avoid weird scroll positions when switching pages.
	try {
		window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
	} catch {
		window.scrollTo(0, 0)
	}

	const hasExplicitHash = typeof location.hash === 'string' && location.hash.length > 1
	if (!hasExplicitHash) {
		// Default route should be visible in the URL, but don't add a history entry.
		try {
			history.replaceState(null, '', `#${target}`)
		} catch {
			location.hash = `#${target}`
		}
	} else if (target !== route) {
		// Keep the URL consistent with the redirect.
		location.hash = `#${target}`
	}
}

window.addEventListener('hashchange', renderRoute)
topbarMenuToggle?.addEventListener('click', () => {
	const isOpen = topbarMenuToggle.getAttribute('aria-expanded') === 'true'
	topbarMenuToggle.setAttribute('aria-expanded', isOpen ? 'false' : 'true')
	if (primaryNavigation) primaryNavigation.hidden = isOpen
})

primaryNavigation?.addEventListener('click', (event) => {
	if (!(event.target instanceof HTMLAnchorElement)) return
	if (topbarMenuToggle) topbarMenuToggle.setAttribute('aria-expanded', 'false')
	primaryNavigation.hidden = true
})

dashboardNotificationInboxWrap?.addEventListener('click', (event) => {
	const target = /** @type {HTMLElement | null} */ (event.target)
	const openOlderBtn = /** @type {HTMLButtonElement | null} */ (target?.closest?.('[data-action="open-older-notifications"]'))
	if (!openOlderBtn || !olderNotificationsModal) return
	if (typeof olderNotificationsModal.showModal === 'function') {
		if (!olderNotificationsModal.open) olderNotificationsModal.showModal()
		return
	}
	olderNotificationsModal.setAttribute('open', '')
})

closeOlderNotificationsBtn?.addEventListener('click', () => {
	if (!olderNotificationsModal) return
	if (typeof olderNotificationsModal.close === 'function' && olderNotificationsModal.open) {
		olderNotificationsModal.close()
		return
	}
	olderNotificationsModal.removeAttribute('open')
})

olderNotificationsModal?.addEventListener('click', (event) => {
	if (event.target !== olderNotificationsModal) return
	if (typeof olderNotificationsModal.close === 'function' && olderNotificationsModal.open) {
		olderNotificationsModal.close()
		return
	}
	olderNotificationsModal.removeAttribute('open')
})

starredHighlightsWrap?.addEventListener('click', (event) => {
	const target = /** @type {HTMLElement | null} */ (event.target)
	const actionTarget = target?.closest?.('[data-action]')
	const action = String(actionTarget?.dataset?.action || '')
	if (!action) return
	if (action === 'open-favorites-tab') {
		selectedFavoritesTab = String(actionTarget?.dataset?.favoritesTab || '')
		renderStarredHighlights()
		return
	}
	if (action === 'back-to-favorites-tabs') {
		selectedFavoritesTab = ''
		renderStarredHighlights()
	}
})
renderRoute()

window.addEventListener('focus', () => {
	void refreshDesktopCloudBackedState()
})

document.addEventListener('visibilitychange', () => {
	if (document.visibilityState === 'visible') {
		void refreshDesktopCloudBackedState()
	}
})

updateAuthUi()
void refreshSessionAndLoad()

function loadWebSessionFromStorage() {
	try {
		const raw = localStorage.getItem(WEB_SESSION_KEY)
		if (!raw) return null
		const data = JSON.parse(raw)
		const name = typeof data?.name === 'string' ? data.name.trim() : ''
		const email = typeof data?.email === 'string' ? data.email : ''
		const token = typeof data?.token === 'string' ? data.token : ''
		const cloudUserId = typeof data?.cloudUserId === 'string' ? data.cloudUserId : ''
		const role = normalizeAccountRole(data?.role)
		const assignedInstructorEmail = normalizeAccountEmail(data?.assignedInstructorEmail)
		if (!email || !token) return null
		return {
			id: 0,
			name: name || undefined,
			email,
			token,
			cloudUserId: cloudUserId || undefined,
			role,
			assignedInstructorEmail: assignedInstructorEmail || undefined,
		}
	} catch {
		return null
	}
}

function saveWebSessionToStorage(nextSession) {
	try {
		if (!nextSession?.token) {
			localStorage.removeItem(WEB_SESSION_KEY)
			return
		}
		localStorage.setItem(
			WEB_SESSION_KEY,
			JSON.stringify({
				name: nextSession.name,
				email: nextSession.email,
				token: nextSession.token,
				cloudUserId: nextSession.cloudUserId,
				role: normalizeAccountRole(nextSession.role),
				assignedInstructorEmail: normalizeAccountEmail(nextSession.assignedInstructorEmail),
			})
		)
	} catch {
		// ignore
	}
}

function normalizePersonName(name) {
	if (typeof name !== 'string') return ''
	return name.trim().replace(/\s+/g, ' ').slice(0, 120)
}

async function apiJson({ method, apiPath, token, body, query, contentType }) {
	const base = API_BASE_URL
	const url = base.startsWith('/')
		? new URL(`${base.replace(/\/$/, '')}${apiPath}`, location.origin)
		: new URL(apiPath, base)
	if (query && typeof query === 'object') {
		for (const [k, v] of Object.entries(query)) {
			if (v === undefined || v === null) continue
			url.searchParams.set(k, String(v))
		}
	}

	/** @type {Record<string, string>} */
	const headers = {
		'content-type': (typeof contentType === 'string' && contentType) ? contentType : 'application/json',
		'accept': 'application/json',
	}
	if (token) headers.authorization = `Bearer ${token}`

	let res
	let nativeText = ''
	try {
		if (isNativeApp) {
			const nativeRes = await CapacitorHttp.request({
				url: url.toString(),
				method,
				headers,
				data: body ? JSON.stringify(body) : undefined,
			})
			nativeText = typeof nativeRes.data === 'string' ? nativeRes.data : JSON.stringify(nativeRes.data ?? '')
			res = {
				ok: nativeRes.status >= 200 && nativeRes.status < 300,
				status: nativeRes.status,
				text: async () => nativeText,
			}
		} else {
			res = await fetch(url, {
				method,
				headers,
				body: body ? JSON.stringify(body) : undefined,
			})
		}
	} catch (err) {
		// In browsers this is commonly thrown for CORS failures (preflight blocked),
		// DNS issues, offline mode, or the server refusing the connection.
		const hint = isNativeApp
			? `Network error calling ${url.origin}${url.pathname}. Check device connectivity, HTTPS certificate validity, and whether the API is reachable from Android.`
			: `Network error calling ${url.origin}${url.pathname}. If you're running in a browser (Vite/GitHub Pages), this is often a CORS issue. Your API must allow Origin: ${location.origin} and handle OPTIONS preflight.`
		const e = new Error(hint)
		e.cause = err
		throw e
	}

	const text = await res.text()
	let data = null
	if (text) {
		try {
			data = JSON.parse(text)
		} catch {
			data = null
		}
	}

	if (!res.ok) {
		const backendMsg =
			typeof data?.error === 'string'
				? data.error
				: typeof data?.message === 'string'
					? data.message
					: (typeof text === 'string' && text.trim() ? text.trim() : '')
		const msg = backendMsg || `Request failed (${res.status})`
		const err = new Error(`${msg} [${method} ${url.pathname}]`)
		err.status = res.status
		err.apiPath = apiPath
		err.responseText = typeof text === 'string' ? text.slice(0, 1000) : ''

		// If a previously saved web session token becomes invalid (common after changing
		// JWT secrets), don't silently keep the user "logged in" with stale local data.
		if (!isDesktopApp && res.status === 401 && token) {
			try {
				saveWebSessionToStorage(null)
			} catch {
				// ignore
			}
			session = null
			updateAuthUi()
			showAuthError('Session expired. Please log in again to refresh cloud data.')
		}

		// In desktop mode, ledger sync failures are otherwise silent; log details.
		if (isDesktopApp) {
			try {
				console.warn('API error', { status: res.status, method, path: url.pathname, body: err.responseText })
			} catch {
				// ignore
			}
		}
		throw err
	}

	return data
}

async function cloudRegister(email, password, name) {
	// Use a "simple" Content-Type to avoid CORS preflight in browsers when the API
	// doesn't support OPTIONS. The backend can still parse JSON from the body string.
	return apiJson({ method: 'POST', apiPath: '/auth/register', body: { email, password, name }, contentType: 'text/plain' })
}

async function cloudLogin(email, password) {
	return apiJson({ method: 'POST', apiPath: '/auth/login', body: { email, password }, contentType: 'text/plain' })
}

async function cloudGetGoal({ token }) {
	return apiJson({ method: 'GET', apiPath: '/profile/goal', token })
}

async function cloudGetProfileName({ token }) {
	return apiJson({ method: 'GET', apiPath: '/profile/name', token })
}

async function cloudGetProfileSettings({ token }) {
	return apiJson({ method: 'GET', apiPath: '/profile/settings', token })
}

async function cloudSetGoal({ token, goalDollars }) {
	return apiJson({ method: 'POST', apiPath: '/profile/goal', token, body: { goalDollars } })
}

async function cloudSetProfileName({ token, name }) {
	return apiJson({ method: 'POST', apiPath: '/profile/name', token, body: { name } })
}

async function cloudSetProfileSettings({ token, goalStartDate, goalEndDate }) {
	return apiJson({ method: 'POST', apiPath: '/profile/settings', token, body: { goalStartDate, goalEndDate } })
}

async function cloudGetProfileAccount({ token }) {
	return apiJson({ method: 'GET', apiPath: '/profile/account', token })
}

async function cloudGetInstructorDashboard({ token, instructorEmail }) {
	return apiJson({ method: 'GET', apiPath: '/instructor/dashboard', token, query: instructorEmail ? { instructorEmail } : undefined })
}

async function cloudAssignStudents({ token, instructorEmail, studentEmails }) {
	return apiJson({ method: 'POST', apiPath: '/instructor/assign-students', token, body: { instructorEmail, studentEmails } })
}

async function cloudCreateInstructorAccount({ token, email, name, password }) {
	return apiJson({ method: 'POST', apiPath: '/instructor/create-account', token, body: { email, name, password } })
}

async function cloudSetInstructorRole({ token, email, role }) {
	return apiJson({ method: 'POST', apiPath: '/instructor/set-role', token, body: { email, role } })
}

async function cloudSendInstructorNotification({ token, message, scope, instructorEmail }) {
	return apiJson({ method: 'POST', apiPath: '/instructor/notifications', token, body: { message, scope, instructorEmail } })
}

function formatDollarsFromUnits(units) {
	const dollars = units * DOLLARS_PER_UNIT
	return `$${dollars.toLocaleString()}`
}

function formatDateLabel(ms) {
	return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function parseMoneyInput(input) {
	// Keep it forgiving: treat empty/invalid as 0.
	const n = Number(input)
	if (!Number.isFinite(n)) return 0
	return Math.max(0, n)
}

function formatDollars(dollars) {
	const safe = Math.max(0, Math.round(dollars))
	return `$${safe.toLocaleString()}`
}

function formatSignedDollars(dollars) {
	const rounded = Math.round(Number(dollars) || 0)
	const sign = rounded < 0 ? '-' : ''
	const abs = Math.abs(rounded)
	return `${sign}$${abs.toLocaleString()}`
}

function clamp(n, min, max) {
	return Math.min(max, Math.max(min, n))
}

function startOfLocalMonthMs(date) {
	return new Date(date.getFullYear(), date.getMonth(), 1).getTime()
}

function addYearsMs(startMs, years) {
	const d = new Date(startMs)
	d.setFullYear(d.getFullYear() + years)
	return d.getTime()
}

function addMonthsMs(startMs, months) {
	const d = new Date(startMs)
	d.setMonth(d.getMonth() + months)
	return d.getTime()
}

function formatMonthLabel(monthMs) {
	const d = new Date(monthMs)
	const m = d.getMonth() + 1
	const yy = String(d.getFullYear()).slice(-2)
	return `${m}/${yy}`
}

function loadGoalDollarsFromLocalStorage() {
	try {
		const raw = localStorage.getItem(GOAL_STORAGE_KEY)
		if (!raw) return 0
		const n = Number(raw)
		if (!Number.isFinite(n)) return 0
		return Math.max(0, Math.round(n))
	} catch {
		return 0
	}
}

function saveGoalDollarsToLocalStorage(goalDollars) {
	try {
		localStorage.setItem(GOAL_STORAGE_KEY, String(Math.max(0, Math.round(goalDollars))))
	} catch {
		// ignore
	}
}

function showAuthError(message) {
	if (!authError) return
	authError.textContent = message
	authError.hidden = !message
}

function setAuthMode(mode) {
	authMode = mode === 'register' ? 'register' : 'login'
	if (!authNameField || !loginBtn || !registerBtn || !authHint || !authModeLoginBtn || !authModeRegisterBtn) return

	const isRegister = authMode === 'register'
	authNameField.hidden = !isRegister
	authHint.hidden = false
	loginBtn.textContent = isRegister ? 'Create account' : 'Log in'
	registerBtn.textContent = isRegister ? 'Back to login' : 'Create account instead'
	authHint.textContent = isRegister
		? 'Create an account with your name, email, and password.'
		: 'Use your email and password to log in.'
	authModeLoginBtn.classList.toggle('auth-mode-btn--active', !isRegister)
	authModeRegisterBtn.classList.toggle('auth-mode-btn--active', isRegister)
	authPassword.autocomplete = isRegister ? 'new-password' : 'current-password'
	showAuthError('')
}

function resetGoalUi({ persistLocal }) {
	setGoalUnits(0)
	setGoalSliderLocked(false)
	if (persistLocal) saveGoalDollarsToLocalStorage(0)
}

let didWarnWebSync = false
let didWarnDesktopGoalSync = false
function warnWebSyncIfNeeded(err) {
	if (isDesktopApp) return
	if (didWarnWebSync) return
	const msg = String(err?.message || '')
	if (!msg) return
	if (!msg.toLowerCase().includes('cors')) return
	didWarnWebSync = true
	showAuthError(msg)
}

function updateAuthUi() {
	if (!authStatus || !authForm) return
	const isSuperInstructor = isSuperInstructorSession()
	if (habitBoxesNavLink) habitBoxesNavLink.hidden = true
	if (instructorNavLink) instructorNavLink.hidden = !isInstructorSession()
	if (studentDetailNavLink) studentDetailNavLink.hidden = !isInstructorSession()
	if (superAdminNavLink) superAdminNavLink.hidden = !isSuperInstructor
	if (topbarLogoutBtn) topbarLogoutBtn.hidden = !session
	if (dashboardNavLink) dashboardNavLink.hidden = isSuperInstructor
	if (detailsNavLink) detailsNavLink.hidden = isSuperInstructor
	if (monthlyReportNavLink) monthlyReportNavLink.hidden = isSuperInstructor
	if (journalNavLink) journalNavLink.hidden = isSuperInstructor
	if (weeklyNavLink) weeklyNavLink.hidden = isSuperInstructor
	if (starredNavLink) starredNavLink.hidden = isSuperInstructor
	if (habitsNavLink) habitsNavLink.hidden = isSuperInstructor
	if (settingsNavLink) settingsNavLink.hidden = isSuperInstructor

	if (session) {
		const cloudStatus = isDesktopApp ? (session?.token ? ' (cloud sync ON)' : ' (cloud sync OFF)') : ''
		const identity = session.name || session.email
		const roleLabel = normalizeAccountRole(session.role)
		const roleText = roleLabel === 'student' ? '' : ` · ${roleLabel}`
		authStatus.textContent = `Logged in as ${identity}${roleText}${cloudStatus}`
		if (authModeSwitch) authModeSwitch.hidden = true
		if (authHint) {
			authHint.hidden = true
			authHint.textContent = 'Manage your profile details in Settings.'
		}
		const dashboardName = profileSettings.name || session.name || 'No name set'
		const dashboardEmail = profileSettings.email || session.email || 'No email set'
		const dashboardContact = profileSettings.contactInfo || 'Add contact info in Settings.'
		if (profileCurrentName) profileCurrentName.textContent = dashboardName
		if (profileCurrentEmail) profileCurrentEmail.textContent = dashboardEmail
		if (profileCurrentContact) profileCurrentContact.textContent = dashboardContact
		if (profileSummary) profileSummary.hidden = false
		authForm.classList.add('auth-form--hidden')
		authModeLoginBtn.hidden = true
		authModeRegisterBtn.hidden = true
		showAuthError('')
	} else {
		authStatus.textContent = 'Not logged in'
		if (authModeSwitch) authModeSwitch.hidden = false
		if (authHint) authHint.hidden = false
		if (profileSummary) profileSummary.hidden = true
		authForm.classList.remove('auth-form--hidden')
		authModeLoginBtn.hidden = false
		authModeRegisterBtn.hidden = false
		showAuthError('')
		setAuthMode(authMode)
	}
	renderAccountNotifications()
	setDashboardAuthGate(Boolean(session))
	renderRoute()
}

async function persistProfileName(name) {
	if (!session) throw new Error('Not logged in')
	const safeName = normalizePersonName(name)

	if (isDesktopApp) {
		if (!desktop?.profile?.setName) throw new Error('Profile updates are unavailable in this build')
		const out = await desktop.profile.setName(safeName)
		const nextName = normalizePersonName(out?.name)
		session = { ...session, name: nextName || safeName || undefined }
		updateAuthUi()
		return
	}

	if (!session.token) throw new Error('Cloud sync is unavailable (no AWS token)')
	const out = await cloudSetProfileName({ token: session.token, name: safeName })
	const nextName = normalizePersonName(out?.name)
	session = { ...session, name: nextName || safeName || undefined }
	saveWebSessionToStorage(session)
	updateAuthUi()
}

async function hydrateProfileNameFromCloud() {
	if (!session?.token) return

	try {
		if (isDesktopApp) {
			if (!desktop?.profile?.getName) return
			const out = await desktop.profile.getName()
			const nextName = normalizePersonName(out?.name)
			if (nextName !== (session.name || '')) {
				session = { ...session, name: nextName || undefined }
				updateAuthUi()
			}
			return
		}

		const out = await cloudGetProfileName({ token: session.token })
		const nextName = normalizePersonName(out?.name)
		if (nextName !== (session.name || '')) {
			session = { ...session, name: nextName || undefined }
			saveWebSessionToStorage(session)
			updateAuthUi()
		}
	} catch {
		// ignore
	}
}

async function hydrateAccountFromCloud() {
	if (!session?.token || isDesktopApp) return false
	try {
		const out = await cloudGetProfileAccount({ token: session.token })
		applyAccountSnapshot(out)
		return true
	} catch {
		return false
	}
}

let accountRefreshInFlight = false
async function refreshAccountFromCloud() {
	if (!session?.token || isDesktopApp || accountRefreshInFlight) return false
	accountRefreshInFlight = true
	try {
		return await hydrateAccountFromCloud()
	} finally {
		accountRefreshInFlight = false
	}
}

async function hydrateProfileSettingsFromCloud() {
	if (!session?.token || isDesktopApp) return

	try {
		const out = await cloudGetProfileSettings({ token: session.token })
		const nextSettings = sanitizeProfileSettings({
			...profileSettings,
			goalStartDate: out?.goalStartDate || profileSettings.goalStartDate,
			goalEndDate: out?.goalEndDate || profileSettings.goalEndDate,
		})
		saveProfileSettingsToStorage(nextSettings, { persistRendererState: false })
	} catch {
		// keep local settings when cloud settings are unavailable
	}
}

let profileSettingsCloudRefreshInFlight = false
async function refreshProfileSettingsFromCloud({ rerenderIfVisible = false } = {}) {
	if (!session?.token || isDesktopApp) return false
	if (profileSettingsCloudRefreshInFlight) return false
	profileSettingsCloudRefreshInFlight = true

	try {
		const before = sanitizeProfileSettings(profileSettings)
		await hydrateProfileSettingsFromCloud()
		const after = sanitizeProfileSettings(profileSettings)
		const changed = before.goalStartDate !== after.goalStartDate || before.goalEndDate !== after.goalEndDate
		if (!changed) return false
		updateProgress()
		if (normalizeRoute(location.hash) === 'details') drawDetails()
		if (rerenderIfVisible && normalizeRoute(location.hash) === 'settings') renderSettingsPanel({ skipCloudRefresh: true })
		return true
	} finally {
		profileSettingsCloudRefreshInFlight = false
	}
}

async function persistProfileGoalTimeline(nextSettings) {
	if (!session?.token) throw new Error('Cloud sync is unavailable (no AWS token)')
	const out = await cloudSetProfileSettings({
		token: session.token,
		goalStartDate: nextSettings.goalStartDate,
		goalEndDate: nextSettings.goalEndDate,
	})
	const mergedSettings = sanitizeProfileSettings({
		...profileSettings,
		goalStartDate: out?.goalStartDate || nextSettings.goalStartDate,
		goalEndDate: out?.goalEndDate || nextSettings.goalEndDate,
	})
	saveProfileSettingsToStorage(mergedSettings)
	return mergedSettings
}

function renderAccountNotifications() {
	if (!notificationInboxWrap && !dashboardNotificationInboxWrap) return
	const isStudent = normalizeAccountRole(session?.role) === 'student'
	if (!session || !accountNotifications.length) {
		if (notificationInboxWrap) notificationInboxWrap.innerHTML = ''
		if (dashboardNotificationInboxWrap) dashboardNotificationInboxWrap.innerHTML = ''
		if (olderNotificationsList) olderNotificationsList.innerHTML = '<div class="breakdown-empty">No older notifications.</div>'
		return
	}
	const cutoffMs = Date.now() - (30 * DAY_MS)
	const recentItems = accountNotifications.filter((item) => Number(item?.createdAtMs) >= cutoffMs).slice(0, 8)
	const olderItems = accountNotifications.filter((item) => Number(item?.createdAtMs) < cutoffMs)

	const recentMarkup = `<div class="instructor-panel instructor-panel--compact"><div class="instructor-panel-head"><div><div class="habit-kicker">Notifications</div><h3 class="instructor-panel-title">Recent updates</h3></div><div class="habit-card-chip-row"><span class="habit-card-chip">${recentItems.length}</span>${olderItems.length ? `<button type="button" class="auth-btn auth-btn--secondary" data-action="open-older-notifications">View older (${olderItems.length})</button>` : ''}</div></div><div class="instructor-notification-list">${recentItems.length ? recentItems.map((item) => `<article class="instructor-note"><div class="instructor-note-head"><strong>${escapeHtml(item.senderEmail || 'Instructor')}</strong><span>${escapeHtml(formatDateLabel(item.createdAtMs || Date.now()))}</span></div><p>${escapeHtml(item.message)}</p></article>`).join('') : '<div class="breakdown-empty">No notifications in the last 30 days.</div>'}</div></div>`

	if (notificationInboxWrap) notificationInboxWrap.innerHTML = ''
	if (dashboardNotificationInboxWrap) dashboardNotificationInboxWrap.innerHTML = isStudent ? recentMarkup : ''

	if (olderNotificationsSummary) {
		olderNotificationsSummary.textContent = olderItems.length
			? `${olderItems.length} older notification${olderItems.length === 1 ? '' : 's'} from before the last 30 days.`
			: 'No older notifications.'
	}
	if (olderNotificationsList) {
		olderNotificationsList.innerHTML = olderItems.length
			? olderItems.map((item) => `<article class="instructor-note"><div class="instructor-note-head"><strong>${escapeHtml(item.senderEmail || 'Instructor')}</strong><span>${escapeHtml(formatDateLabel(item.createdAtMs || Date.now()))}</span></div><p>${escapeHtml(item.message)}</p></article>`).join('')
			: '<div class="breakdown-empty">No older notifications.</div>'
	}
}

let instructorDashboardRefreshInFlight = false
async function refreshInstructorDashboard({ rerenderIfVisible = false } = {}) {
	if (!session?.token || !isInstructorSession() || instructorDashboardRefreshInFlight) return false
	instructorDashboardRefreshInFlight = true
	try {
		const out = await cloudGetInstructorDashboard({
			token: session.token,
			instructorEmail: isSuperInstructorSession() ? selectedInstructorRosterEmail : '',
		})
		instructorDashboardState = {
			role: normalizeAccountRole(out?.role || session.role),
			instructors: Array.isArray(out?.instructors) ? out.instructors : [],
			students: Array.isArray(out?.students) ? out.students : [],
			allStudents: Array.isArray(out?.allStudents) ? out.allStudents : [],
		}
		selectedInstructorRosterEmail = normalizeAccountEmail(out?.instructor?.email) || selectedInstructorRosterEmail
		if (rerenderIfVisible) {
			const currentRoute = normalizeRoute(location.hash)
			if (currentRoute === 'instructor') renderInstructorPanel({ skipRefresh: true })
			if (currentRoute === 'instructor-student') renderInstructorStudentPanel({ skipRefresh: true })
			if (currentRoute === 'super-admin') renderSuperAdminPanel({ skipRefresh: true })
		}
		return true
	} catch {
		return false
	} finally {
		instructorDashboardRefreshInFlight = false
	}
}

function setDashboardAuthGate(isAuthed) {
	if (dashboardGate) dashboardGate.hidden = isAuthed
	if (dashboardContent) dashboardContent.hidden = !isAuthed
}

function renderDashboardHabitFocus() {
	if (!dashboardHabitFocus || !dashboardHabitChecks || !dashboardHabitCopy) return
	if (!session) {
		dashboardHabitFocus.hidden = true
		return
	}
	const safeState = sanitizeHabitBoardState(habitBoardState)
	const items = getHabitSquareItems(safeState)
	dashboardHabitFocus.hidden = false
	if (!items.length) {
		dashboardHabitChecks.textContent = '0/0 habits today'
		dashboardHabitCopy.textContent = 'Set up Habit Boxes to track today.'
		return
	}
	const currentWeekKey = getDailyWeekKey(startOfLocalWeekMs(new Date()))
	const weekState = getDailyWeekState(currentWeekKey)
	const todayIndex = getCurrentWeekdayIndex(new Date())
	const today = weekState.days?.[todayIndex] || { checks: [] }
	const completed = Array.isArray(today.checks) ? today.checks.filter(Boolean).length : 0
	const total = items.length
	dashboardHabitChecks.textContent = `${completed}/${total} habits today`
	if (today.didWell) {
		dashboardHabitCopy.textContent = `Did well: ${truncateText(today.didWell, 120)}`
	} else if (today.did) {
		dashboardHabitCopy.textContent = `Logged today: ${truncateText(today.did, 120)}`
	} else {
		dashboardHabitCopy.textContent = 'No day notes yet. Keep momentum with one habit at a time.'
	}
}

function renderWeeklyThought() {
	if (dashboardWeeklyThought) dashboardWeeklyThought.textContent = weeklyThought
}

function updateDashboardSummary({ goalDollars, currentDollars }) {
	if (weeklySavingsOut || monthlySavingsOut || yearlySavingsOut || weeklyExpensesOut || monthlyExpensesOut || yearlyExpensesOut) {
		const today = startOfLocalDayMs(new Date())
		const week = buildPeriodSeries('week', today).totals
		const month = buildPeriodSeries('month', today).totals
		const year = buildPeriodSeries('year', today).totals

		if (weeklySavingsOut) weeklySavingsOut.textContent = formatDollars(week.savingsDollars)
		if (monthlySavingsOut) monthlySavingsOut.textContent = formatDollars(month.savingsDollars)
		if (yearlySavingsOut) yearlySavingsOut.textContent = formatDollars(year.savingsDollars)

		if (weeklyExpensesOut) weeklyExpensesOut.textContent = formatDollars(week.expensesDollars)
		if (monthlyExpensesOut) monthlyExpensesOut.textContent = formatDollars(month.expensesDollars)
		if (yearlyExpensesOut) yearlyExpensesOut.textContent = formatDollars(year.expensesDollars)
	}

	const pct = goalDollars > 0 ? clamp(currentDollars / goalDollars, 0, 1) : 0
	if (goalBarFill) goalBarFill.style.width = `${Math.round(pct * 1000) / 10}%`
	if (barCurrent) barCurrent.textContent = `Current: ${formatDollars(currentDollars)}`
	if (barGoal) barGoal.textContent = `Goal: ${formatDollars(goalDollars)}`

	const timeline = getGoalTimeline()
	const weeklySnapshot = getWeeklyGoalSnapshot(goalDollars, currentDollars, timeline)
	if (goalStartDateOut) goalStartDateOut.textContent = formatDateLabel(timeline.startMs)
	if (goalEndDateOut) goalEndDateOut.textContent = formatDateLabel(timeline.endMs)
	if (goalWeeklyTargetOut) goalWeeklyTargetOut.textContent = formatDollars(weeklySnapshot.weeklyDollars)
	if (goalWeeklyCopyOut) goalWeeklyCopyOut.textContent = weeklySnapshot.copy
	renderWeeklyThought()
	renderDashboardHabitFocus()
	if (isFinancialOverviewModalOpen()) renderFinancialOverview()
}

function isFinancialOverviewModalOpen() {
	return Boolean(financialOverviewModal && (financialOverviewModal.open || financialOverviewModal.hasAttribute('open')))
}

function renderFinancialOverview() {
	if (!financialOverviewModal) return
	if (!session) {
		if (overviewMonthlyIncomeOut) overviewMonthlyIncomeOut.textContent = '$0'
		if (overviewMonthlyExpensesOut) overviewMonthlyExpensesOut.textContent = '$0'
		if (overviewMonthlySavingsOut) overviewMonthlySavingsOut.textContent = '$0'
		if (overviewYearlyIncomeOut) overviewYearlyIncomeOut.textContent = '$0'
		if (overviewYearlyExpensesOut) overviewYearlyExpensesOut.textContent = '$0'
		if (overviewYearlySavingsOut) overviewYearlySavingsOut.textContent = '$0'
		return
	}
	const today = startOfLocalDayMs(new Date())
	const month = buildPeriodSeries('month', today).totals
	const year = buildPeriodSeries('year', today).totals

	if (overviewMonthlyIncomeOut) overviewMonthlyIncomeOut.textContent = formatDollars(month.incomeDollars)
	if (overviewMonthlyExpensesOut) overviewMonthlyExpensesOut.textContent = formatDollars(month.expensesDollars)
	if (overviewMonthlySavingsOut) overviewMonthlySavingsOut.textContent = formatDollars(month.savingsDollars)

	if (overviewYearlyIncomeOut) overviewYearlyIncomeOut.textContent = formatDollars(year.incomeDollars)
	if (overviewYearlyExpensesOut) overviewYearlyExpensesOut.textContent = formatDollars(year.expensesDollars)
	if (overviewYearlySavingsOut) overviewYearlySavingsOut.textContent = formatDollars(year.savingsDollars)

	const goalDollars = Number(range?.value || 0) * DOLLARS_PER_UNIT
	const currentDollars = getCurrentSavingsForGoalProgress()
	const pct = goalDollars > 0 ? clamp(currentDollars / goalDollars, 0, 1) : 0
	if (overviewGoalBarFill) overviewGoalBarFill.style.width = `${Math.round(pct * 1000) / 10}%`
	if (overviewGoalCurrentOut) overviewGoalCurrentOut.textContent = `Current: ${formatDollars(currentDollars)}`
	if (overviewGoalGoalOut) overviewGoalGoalOut.textContent = `Goal: ${formatDollars(goalDollars)}`
	if (overviewGoalPctOut) overviewGoalPctOut.textContent = `${Math.round(pct * 100)}%`

	const timeline = getGoalTimeline()
	const weeklySnapshot = getWeeklyGoalSnapshot(goalDollars, currentDollars, timeline)
	if (overviewGoalWeeklyTargetOut) overviewGoalWeeklyTargetOut.textContent = formatDollars(weeklySnapshot.weeklyDollars)
	if (overviewGoalWeeklyCopyOut) overviewGoalWeeklyCopyOut.textContent = weeklySnapshot.copy
}

function openFinancialOverviewModal() {
	renderFinancialOverview()
	if (!financialOverviewModal) return
	if (typeof financialOverviewModal.showModal === 'function') {
		if (!financialOverviewModal.open) financialOverviewModal.showModal()
		return
	}
	financialOverviewModal.setAttribute('open', '')
}

function closeFinancialOverviewModal() {
	if (!financialOverviewModal) return
	if (financialOverviewModal.open && typeof financialOverviewModal.close === 'function') {
		financialOverviewModal.close()
	} else {
		financialOverviewModal.removeAttribute('open')
	}
}

openFinancialOverviewBtn?.addEventListener('click', openFinancialOverviewModal)
openFinancialOverviewBtnDetails?.addEventListener('click', openFinancialOverviewModal)
closeFinancialOverviewBtn?.addEventListener('click', closeFinancialOverviewModal)
financialOverviewModal?.addEventListener('click', (event) => {
	if (event.target === financialOverviewModal) closeFinancialOverviewModal()
})

async function refreshSessionAndLoad() {
	if (isDesktopApp) {
		try {
			session = await desktop.auth.getSession()
		} catch {
			session = null
		}
	} else {
		session = loadWebSessionFromStorage()
	}
	await loadUserScopedAppState()
	updateAuthUi()
	if (isDesktopApp) {
		if (session) {
			await hydrateProfileNameFromCloud()
			await loadGoalFromDbOrMigrate()
			await loadSavingsLogEntriesFromDesktop()
			await loadLedgerEntriesFromStorage()
			void syncLedgerWithCloud()
		}
		updateProgress()
		renderRoute()
		return
	}

	// Web mode: if logged in, pull goal from cloud + ledger from localStorage.
	if (session?.token) {
		await hydrateAccountFromCloud()
		await hydrateProfileNameFromCloud()
		await hydrateProfileSettingsFromCloud()
		await hydrateRendererStateFromCloud()
		resetGoalUi({ persistLocal: false })
		await loadGoalFromCloudOrFallback()
		await loadLedgerEntriesFromStorage()
		void syncLedgerWithCloud()
	}
	updateAuthUi()
	updateProgress()
	renderRoute()
}

async function refreshDesktopCloudBackedState() {
	if (!isDesktopApp || !session) return
	await loadUserScopedAppState()
	await loadGoalFromDbOrMigrate()
	await loadSavingsLogEntriesFromDesktop()
	updateAuthUi()
	updateProgress()
	renderRoute()
}

async function loadGoalFromCloudOrFallback() {
	if (!session?.token) return
	let goalDollars = 0
	try {
		const out = await cloudGetGoal({ token: session.token })
		goalDollars = Number(out?.goalDollars)
	} catch (err) {
		warnWebSyncIfNeeded(err)
		goalDollars = 0
	}
	if (!Number.isFinite(goalDollars) || goalDollars < 0) goalDollars = 0
	if (goalDollars > 0) {
		setGoalUnits(goalDollars / DOLLARS_PER_UNIT)
		setGoalSliderLocked(true)
		saveGoalDollarsToLocalStorage(goalDollars)
		return
	}

	// No cloud goal saved yet; reset to zero so we don't keep a previous user's slider.
	resetGoalUi({ persistLocal: true })
}


let suppressGoalPersist = false
let goalTimer = null

function updateGoalSliderUi() {
	if (range) range.disabled = isGoalSliderLocked
	if (goalEditBtn) goalEditBtn.hidden = !isGoalSliderLocked
	if (goalSliderHint) {
		goalSliderHint.textContent = isGoalSliderLocked
			? 'Goal locked to avoid accidental changes on mobile. Tap Edit goal to adjust it.'
			: 'Move the slider to set your goal. It will lock after you choose it.'
	}
}

function setGoalSliderLocked(isLocked) {
	isGoalSliderLocked = Boolean(isLocked)
	updateGoalSliderUi()
}

function setGoalUnits(units) {
	suppressGoalPersist = true
	range.value = String(clamp(Math.round(units), MIN, MAX))
	onInput()
	suppressGoalPersist = false
}

async function loadGoalFromDbOrMigrate() {
	if (!session) return
	if (!desktop?.profile?.getGoal) return

	let goalDollars = 0
	try {
		const out = await desktop.profile.getGoal()
		goalDollars = Number(out?.goalDollars)
	} catch {
		goalDollars = 0
	}

	if (!Number.isFinite(goalDollars) || goalDollars < 0) goalDollars = 0

	// If the account has no saved goal yet, seed it from localStorage (if present).
	if (goalDollars <= 0) {
		const localGoal = loadGoalDollarsFromLocalStorage()
		if (localGoal > 0) {
			goalDollars = localGoal
			try {
				await desktop.profile.setGoal(goalDollars)
			} catch {
				// ignore
			}
		}
	}

	setGoalUnits(goalDollars / DOLLARS_PER_UNIT)
	setGoalSliderLocked(goalDollars > 0)
	saveGoalDollarsToLocalStorage(goalDollars)
}

async function persistGoalDollars(goalDollars) {
	const safe = Math.max(0, Math.round(goalDollars))
	saveGoalDollarsToLocalStorage(safe)

	if (!session?.token) return
	try {
		await cloudSetGoal({ token: session.token, goalDollars: safe })
	} catch (err) {
		warnWebSyncIfNeeded(err)
		// ignore
	}
}

function layoutRocket() {
	const wrap = range.parentElement
	if (!wrap) return

	const value = Number(range.value)
	const percent = (value - MIN) / (MAX - MIN)

	const wrapRect = wrap.getBoundingClientRect()
	const rangeRect = range.getBoundingClientRect()
	const rocketRect = rocket.getBoundingClientRect()

	// Compute X relative to wrapper so the rocket stays fully inside.
	const available = rangeRect.width - rocketRect.width
	const x = clamp(available * percent, 0, Math.max(0, available))

	// Position rocket above the thumb/track.
	const top = rangeRect.top - wrapRect.top + rangeRect.height / 2
	rocket.style.transform = `translate3d(${x}px, ${top}px, 0) translate3d(0, -50%, 0)`
}

function startOfLocalWeekMs(date) {
	const d = new Date(date)
	const day = d.getDay() // 0=Sun ... 6=Sat
	const diff = (day + 6) % 7 // Monday=0
	d.setDate(d.getDate() - diff)
	d.setHours(0, 0, 0, 0)
	return d.getTime()
}

function formatShortDate(ms) {
	const d = new Date(ms)
	return d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })
}

function formatYear(ms) {
	return String(new Date(ms).getFullYear())
}

function fourYearWindowStartDayMs() {
	const now = new Date()
	const start = new Date(now.getFullYear() - PROGRAM_YEARS, now.getMonth(), now.getDate())
	return startOfLocalDayMs(start)
}

function getGoalTimeline() {
	const safeSettings = sanitizeProfileSettings(profileSettings)
	const startMs = parseDateInputToDayMs(safeSettings.goalStartDate)
	let endMs = parseDateInputToDayMs(safeSettings.goalEndDate)
	if (!Number.isFinite(endMs) || endMs <= startMs) endMs = addYearsMs(startMs, PROGRAM_YEARS)
	return { startMs, endMs }
}

function sumLedgerSavingsSince(startDayMs) {
	const start = Number(startDayMs)
	if (!Number.isFinite(start)) return 0
	let total = 0
	for (const e of ledgerEntries) {
		const dayMs = Number(e?.dayMs)
		if (!Number.isFinite(dayMs) || dayMs < start) continue
		total += Math.max(0, Number(e?.savingsDollars) || 0)
	}
	return total
}

function getCurrentSavingsForGoalProgress() {
	if (!session) return 0
	const ledgerSavings = sumLedgerSavingsSince(getGoalTimeline().startMs)
	const latestSavedBalance = savingsLogEntries.length
		? Math.max(0, Number(savingsLogEntries[savingsLogEntries.length - 1]?.dollars) || 0)
		: 0
	return latestSavedBalance > 0 ? latestSavedBalance : ledgerSavings
}

function getWeeklyGoalSnapshot(goalDollars, currentDollars, timeline = getGoalTimeline()) {
	const nowMs = startOfLocalDayMs(new Date())
	const remainingDollars = Math.max(0, Math.round(goalDollars - currentDollars))
	const effectiveStartMs = Math.max(nowMs, timeline.startMs)
	const remainingMs = Math.max(0, timeline.endMs - effectiveStartMs)
	const weeksRemaining = Math.max(1, Math.ceil(remainingMs / (7 * DAY_MS)))
	if (remainingDollars <= 0) {
		return { weeklyDollars: 0, copy: 'Goal met for the current timeline.' }
	}
	if (timeline.endMs <= nowMs) {
		return { weeklyDollars: remainingDollars, copy: 'Timeline has ended. Update your dates in Settings.' }
	}
	return {
		weeklyDollars: Math.ceil(remainingDollars / weeksRemaining),
		copy: `${weeksRemaining} week${weeksRemaining === 1 ? '' : 's'} remaining based on current savings.`,
	}
}

function getEntriesForCurrentPeriod() {
	const { startMs, endMs } = getPeriodBounds(detailKind, detailAnchorDayMs)
	return ledgerEntries
		.filter((entry) => Number(entry?.dayMs) >= startMs && Number(entry?.dayMs) < endMs)
		.slice()
		.sort((a, b) => Number(b?.dayMs) - Number(a?.dayMs))
}

function buildFundTotals(entries) {
	const totals = new Map()
	for (const fundName of DEFAULT_FUND_NAMES) totals.set(fundName, 0)
	totals.set('Unallocated', 0)
	for (const entry of entries) {
		const savings = Math.max(0, Number(entry?.savingsDollars) || 0)
		const meta = getLedgerEntryMeta(entry?.clientId)
		let allocated = 0
		for (const [fundName, amount] of Object.entries(meta.funds || {})) {
			const safeFundName = normalizeFundName(fundName)
			const safeAmount = Math.max(0, Math.round(Number(amount) || 0))
			if (!safeFundName || safeAmount <= 0) continue
			totals.set(safeFundName, (totals.get(safeFundName) || 0) + safeAmount)
			allocated += safeAmount
		}
		if (savings > allocated) totals.set('Unallocated', (totals.get('Unallocated') || 0) + (savings - allocated))
	}
	return [...totals.entries()].filter(([, amount]) => amount > 0)
}

function renderFundSummary() {
	if (!fundSummaryWrap) return
	if (!session) {
		fundSummaryWrap.innerHTML = '<div class="breakdown-empty">Log in to review savings funds.</div>'
		return
	}
	const totals = buildFundTotals(getEntriesForCurrentPeriod())
	if (!totals.length) {
		fundSummaryWrap.innerHTML = '<div class="breakdown-empty">No savings fund activity in this period yet.</div>'
		return
	}
	fundSummaryWrap.innerHTML = totals.map(([fundName, amount]) => `<div class="fund-pill"><span>${escapeHtml(fundName)}</span><strong>${formatDollars(amount)}</strong></div>`).join('')
}

function renderEntryFeed() {
	if (!entryFeedWrap) return
	if (!session) {
		entryFeedWrap.innerHTML = '<div class="breakdown-empty">Log in to review recent entries.</div>'
		return
	}
	const entries = getEntriesForCurrentPeriod().slice(0, 8)
	if (!entries.length) {
		entryFeedWrap.innerHTML = '<div class="breakdown-empty">No entries in this period yet.</div>'
		return
	}
	entryFeedWrap.innerHTML = `<ul class="entry-feed">${entries.map((entry) => {
		const meta = getLedgerEntryMeta(entry.clientId)
		const fundList = Object.entries(meta.funds || {})
			.filter(([, amount]) => Number(amount) > 0)
			.map(([fundName, amount]) => `${fundName}: ${formatDollars(amount)}`)
			.join(' · ')
		return `<li class="entry-feed-item">
			<div class="entry-feed-head">
				<strong>${escapeHtml(formatDateLabel(entry.dayMs))}</strong>
				<span>${formatDollars(entry.savingsDollars)} saved</span>
			</div>
			<div class="entry-feed-line">Income: ${formatDollars(entry.incomeDollars)}${meta.incomeSource ? ` · ${escapeHtml(meta.incomeSource)}` : ''}${meta.incomeNote ? ` · ${escapeHtml(meta.incomeNote)}` : ''}</div>
			<div class="entry-feed-line">Expenses: ${formatDollars(entry.expensesDollars)}${meta.expenseCategory ? ` · ${escapeHtml(meta.expenseCategory)}` : ''}${meta.expenseNote ? ` · ${escapeHtml(meta.expenseNote)}` : ''}</div>
			<div class="entry-feed-line">Funds: ${escapeHtml(fundList || 'Unallocated')}</div>
		</li>`
	}).join('')}</ul>`
}

function renderHabitBoard() {
	if (!habitBoardWrap) return
	if (!session) {
		habitBoardWrap.innerHTML = '<div class="habit-gate">Log in to use the habit tracker.</div>'
		return
	}
	const safeState = sanitizeHabitBoardState(habitBoardState)
	const items = getHabitSquareItems(safeState)
	if (!items.length) {
		habitBoardWrap.innerHTML = `
			<div class="habit-gate">
				<div class="habit-kicker">Habit Tracker</div>
				<h3 class="report-title">Start with a blank board</h3>
				<p class="habit-copy">Build your squares in Habit Boxes first. Once you save them, this page will use them right away.</p>
				<div class="auth-actions">
					<button type="button" class="auth-btn" data-action="open-habit-boxes">Set up Habit Boxes</button>
				</div>
			</div>
		`
		ensureHabitBoardInteractionsBound()
		return
	}
	const currentWeekMs = startOfLocalWeekMs(new Date())
	if (dailyReportWeekMs > currentWeekMs) setDailyReportWeek(currentWeekMs)
	const weekMs = startOfLocalWeekMs(new Date(dailyReportWeekMs))
	const weekKey = getDailyWeekKey(weekMs)
	const weekState = getDailyWeekState(weekKey)
	const dayLabels = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
	const completedCount = weekState.days.reduce((count, day) => count + day.checks.filter(Boolean).length, 0)
	const safeDayIndex = Math.max(0, Math.min(6, Number.isFinite(dailyReportDayIndex) ? dailyReportDayIndex : getDefaultDailyFocusIndex(weekMs)))
	dailyReportDayIndex = safeDayIndex
	const focusedDay = weekState.days[safeDayIndex]
	const focusedDayMs = weekMs + (safeDayIndex * DAY_MS)
	const isCurrentWeek = weekMs === currentWeekMs
	const weeklyTotal = items.length * 7
	habitBoardWrap.innerHTML = `
		<div class="daily-report-shell">
			<div class="habit-board-head">
				<div>
					<div class="habit-kicker">Daily Report</div>
				</div>
			</div>
			<div class="daily-week-nav">
				<button type="button" class="auth-btn auth-btn--secondary" data-action="prev-week">Previous Week</button>
				<div class="daily-week-nav-copy">
					<strong>${escapeHtml(formatWeekRangeLabel(weekMs))}</strong>
					<span>${isCurrentWeek ? 'Current week' : 'Past week review'}</span>
				</div>
				<button type="button" class="auth-btn auth-btn--secondary" data-action="next-week" ${weekMs >= currentWeekMs ? 'disabled' : ''}>Next Week</button>
			</div>
			<div class="report-section-intro daily-report-intro" aria-label="Habit tracker quick info">
				<div>
					<h4>Quick Info</h4>
					<p>Focus on one day at a time, then use the weekly recap to review earlier days and move backward through previous weeks.</p>
				</div>
				<div class="habit-card-chip-row">
					<span class="habit-card-chip">Week of ${escapeHtml(formatDateLabel(weekKey))}</span>
					<span class="habit-card-chip">Today: ${focusedDay.checks.filter(Boolean).length}/${items.length}</span>
					<span class="habit-card-chip">Week: ${completedCount}/${weeklyTotal} checked</span>
				</div>
			</div>
			<div class="daily-focus-layout">
				<div class="daily-main-card">
					<div class="daily-focus-head">
						<div>
							<div class="habit-kicker">${isCurrentWeek && safeDayIndex === getCurrentWeekdayIndex(new Date()) ? 'Today\'s Focus' : 'Day Focus'}</div>
							<h3 class="report-title daily-focus-title">${escapeHtml(dayLabels[safeDayIndex])}</h3>
							<p class="habit-copy">${escapeHtml(formatDateLabel(focusedDayMs))}</p>
						</div>
						<div class="daily-focus-meta">
							<span class="habit-card-chip">${focusedDay.checks.filter(Boolean).length}/${items.length} habits</span>
							${focusedDay.isStarred ? '<span class="habit-card-chip">Favorited</span>' : ''}
						</div>
					</div>
					<div class="daily-focus-grid">
						<label class="auth-label daily-focus-field"><span>Did</span><textarea class="auth-input daily-report-textarea" data-day-field="did" data-day-index="${safeDayIndex}" rows="4">${escapeHtml(focusedDay.did)}</textarea></label>
						<label class="auth-label daily-focus-field"><span>Did Well</span><textarea class="auth-input daily-report-textarea" data-day-field="didWell" data-day-index="${safeDayIndex}" rows="4">${escapeHtml(focusedDay.didWell)}</textarea></label>
						<label class="auth-label daily-focus-field daily-focus-field--wide"><span>Could Do Better</span><textarea class="auth-input daily-report-textarea" data-day-field="couldDoBetter" data-day-index="${safeDayIndex}" rows="4">${escapeHtml(focusedDay.couldDoBetter)}</textarea></label>
					</div>
					<div class="daily-focus-fields">
						<div class="daily-report-checks">${items.map((item, habitIndex) => `<button type="button" class="daily-check ${focusedDay.checks[habitIndex] ? 'daily-check--active' : ''}" data-action="toggle-check" data-day-index="${safeDayIndex}" data-habit-index="${habitIndex}" aria-label="${escapeHtml(item.title)} on ${dayLabels[safeDayIndex]}"><span>${escapeHtml(item.icon || String(habitIndex + 1))}</span><small>${escapeHtml(item.title || `Habit ${habitIndex + 1}`)}</small></button>`).join('')}</div>
						<div class="daily-day-star"><button type="button" class="star-toggle ${focusedDay.isStarred ? 'star-toggle--active' : ''}" data-action="toggle-day-star" data-day-index="${safeDayIndex}">${focusedDay.isStarred ? 'Favorited' : 'Favorite day'}</button><button type="button" class="auth-btn auth-btn--secondary" data-action="open-habit-boxes">Edit Boxes</button></div>
					</div>
				</div>
				<div class="daily-side-card">
					<div class="report-block-title">Weekly Recap</div>
					<div class="daily-week-recap">${weekState.days.map((day, dayIndex) => `<button type="button" class="daily-recap-item ${dayIndex === safeDayIndex ? 'daily-recap-item--active' : ''}" data-action="set-day" data-day-index="${dayIndex}"><strong>${escapeHtml(dayLabels[dayIndex])}</strong><span>${day.checks.filter(Boolean).length}/${items.length} habits${day.isStarred ? ' · favorited' : ''}</span><p>${escapeHtml(truncateText(day.didWell || day.did || day.couldDoBetter || 'No notes yet.'))}</p></button>`).join('')}</div>
				</div>
			</div>
		</div>
	`
	ensureHabitBoardInteractionsBound()
}

function ensureHabitBoardInteractionsBound() {
	if (!habitBoardWrap || habitBoardWrap.dataset.bound) return
	habitBoardWrap.addEventListener('click', (event) => {
		const target = /** @type {HTMLElement} */ (event.target)
		const actionTarget = target?.closest?.('[data-action]')
		const action = String(actionTarget?.dataset?.action || '')
		if (!action) return
		if (action === 'open-habit-boxes') {
			location.hash = '#habit-boxes'
			return
		}
		if (action === 'prev-week') {
			setDailyReportWeek(dailyReportWeekMs - (7 * DAY_MS))
			renderHabitBoard()
			return
		}
		if (action === 'next-week') {
			setDailyReportWeek(Math.min(startOfLocalWeekMs(new Date()), dailyReportWeekMs + (7 * DAY_MS)))
			renderHabitBoard()
			return
		}
		if (action === 'set-day') {
			const nextDayIndex = Number(actionTarget.dataset.dayIndex)
			if (!Number.isFinite(nextDayIndex)) return
			dailyReportDayIndex = Math.max(0, Math.min(6, nextDayIndex))
			renderHabitBoard()
			return
		}
		if (action === 'toggle-check') {
			const dayIndex = Number(actionTarget.dataset.dayIndex)
			const habitIndex = Number(actionTarget.dataset.habitIndex)
			if (!Number.isFinite(dayIndex) || !Number.isFinite(habitIndex)) return
			const nextWeek = getDailyWeekState(getDailyWeekKey(dailyReportWeekMs))
			nextWeek.days[dayIndex].checks[habitIndex] = !nextWeek.days[dayIndex].checks[habitIndex]
			setDailyWeekState(getDailyWeekKey(dailyReportWeekMs), nextWeek)
			renderHabitBoard()
			return
		}
		if (action === 'toggle-day-star') {
			const dayIndex = Number(actionTarget.dataset.dayIndex)
			if (!Number.isFinite(dayIndex)) return
			const nextWeek = getDailyWeekState(getDailyWeekKey(dailyReportWeekMs))
			nextWeek.days[dayIndex].isStarred = !nextWeek.days[dayIndex].isStarred
			setDailyWeekState(getDailyWeekKey(dailyReportWeekMs), nextWeek)
			renderHabitBoard()
		}
	})
	habitBoardWrap.addEventListener('input', (event) => {
		const target = /** @type {HTMLInputElement | HTMLTextAreaElement} */ (event.target)
		const dayIndex = Number(target?.dataset?.dayIndex)
		const dayField = String(target?.dataset?.dayField || '')
		if (!Number.isFinite(dayIndex) || !dayField) return
		const nextWeek = getDailyWeekState(getDailyWeekKey(dailyReportWeekMs))
		nextWeek.days[dayIndex][dayField] = target.value
		setDailyWeekState(getDailyWeekKey(dailyReportWeekMs), nextWeek)
	})
	habitBoardWrap.addEventListener('change', () => {
		renderHabitBoard()
	})
	habitBoardWrap.dataset.bound = 'true'
}

function renderHabitBoxesPage() {
	if (!habitBoxesWrap) return
	if (!session) {
		habitBoxesWrap.innerHTML = '<div class="habit-gate">Log in to build and track your habit boxes.</div>'
		return
	}
	const safeState = sanitizeHabitBoardState(habitBoardState)
	const board = safeState.boxes[0] || createEmptyHabitBox(0)
	const completedSquares = board.checks.filter(Boolean).length
	const totalSquares = board.items.length
	habitBoxesWrap.innerHTML = `
		<div class="habit-boxes-shell">
			<div class="habit-board-head">
				<div>
					<div class="habit-kicker">Habit Boxes</div>
					<p class="habit-copy">Build one expandable habit board, click each square when you complete it, and keep each square label clear and simple.</p>
				</div>
				<div class="habit-board-score">${completedSquares}/${totalSquares} squares complete</div>
			</div>
			<div class="habit-boxes-toolbar">
				<p class="habit-copy habit-copy--compact">Add squares whenever you want another habit slot. The board grows and the tracker updates as you edit.</p>
				<div class="auth-actions">
					<button type="button" class="auth-btn" data-action="add-square">Add Square</button>
					<button type="button" class="auth-btn auth-btn--secondary" data-action="finish-habit-boxes" ${totalSquares <= 0 ? 'disabled' : ''}>Save and Return to Habits</button>
				</div>
			</div>
			<div class="habit-boxes-grid"><article class="habit-box-card">
				<div class="habit-box-card-head">
					<div class="habit-box-card-fields">
						<label class="auth-label">
							<span>Board title</span>
							<input class="auth-input" data-box-index="0" data-box-field="title" maxlength="80" value="${escapeHtml(board.title)}" />
						</label>
						<label class="auth-label auth-label--wide">
							<span>Board note</span>
							<input class="auth-input" data-box-index="0" data-box-field="description" maxlength="200" value="${escapeHtml(board.description)}" />
						</label>
					</div>
					<div class="habit-box-card-meta">
						<span class="habit-card-chip">${completedSquares}/${totalSquares} complete</span>
						<button type="button" class="auth-btn auth-btn--secondary" data-action="clear-board">Clear All</button>
					</div>
				</div>
				<div class="habit-box-layout">
					<div class="habit-box-stage">
						<div class="habit-box-grid" data-habit-box-grid role="group" aria-label="${escapeHtml(board.title || 'Habit board')} squares">
							${board.items.map((item, itemIndex) => `<button type="button" class="habit-box-square ${board.checks[itemIndex] ? 'habit-box-square--active' : ''}" data-action="toggle-box-square" data-box-index="0" data-item-index="${itemIndex}" data-preview-item-index="${itemIndex}" aria-pressed="${board.checks[itemIndex] ? 'true' : 'false'}"><span class="habit-box-square-icon">${escapeHtml(item.icon || String(itemIndex + 1))}</span><small>${escapeHtml(item.title || `Square ${itemIndex + 1}`)}</small></button>`).join('')}
						</div>
						<p class="habit-box-stage-copy">${totalSquares > 0 ? 'Click a square to mark that habit complete.' : 'Start by adding your first square, then give it an icon and label.'}</p>
					</div>
					<div class="habit-box-ledger-panel">
						<div class="report-block-title">Square Ledger</div>
						<div class="habit-box-ledger-list">${board.items.map((item, itemIndex) => `<div class="habit-box-ledger-row"><label class="auth-label"><span>Square ${itemIndex + 1} icon</span><input class="auth-input" data-box-index="0" data-item-index="${itemIndex}" data-item-field="icon" maxlength="10" value="${escapeHtml(item.icon)}" /></label><label class="auth-label"><span>Square label</span><input class="auth-input" data-box-index="0" data-item-index="${itemIndex}" data-item-field="title" maxlength="60" value="${escapeHtml(item.title)}" /></label>${board.items.length > 4 ? `<button type="button" class="auth-btn auth-btn--secondary habit-square-remove" data-action="remove-square" data-box-index="0" data-item-index="${itemIndex}">Remove Square</button>` : ''}</div>`).join('')}</div>
					</div>
				</div>
			</article></div>
		</div>
	`
	if (!habitBoxesWrap.dataset.bound) {
		habitBoxesWrap.addEventListener('click', (event) => {
			const target = /** @type {HTMLElement} */ (event.target)
			const actionTarget = target?.closest?.('[data-action]')
			const action = String(actionTarget?.dataset?.action || '')
			if (!action) return
			if (action === 'finish-habit-boxes') {
				location.hash = '#habits'
				return
			}
			if (action === 'add-square') {
				const next = sanitizeHabitBoardState(habitBoardState)
				const boardState = next.boxes[0] || createEmptyHabitBox(0)
				const squareIndex = boardState.items.length
				boardState.items.push(createDefaultHabitSquare(squareIndex))
				boardState.checks.push(false)
				next.boxes = [boardState]
				saveHabitBoardToStorage(next)
				renderHabitBoard()
				renderHabitBoxesPage()
				return
			}
			const boxIndex = Number(actionTarget?.dataset?.boxIndex)
			if (action === 'clear-board') {
				const next = sanitizeHabitBoardState(habitBoardState)
				next.boxes[0].checks = next.boxes[0].checks.map(() => false)
				saveHabitBoardToStorage(next)
				renderHabitBoard()
				renderHabitBoxesPage()
				return
			}
			if (!Number.isFinite(boxIndex)) return
			if (action === 'remove-square') {
				const itemIndex = Number(actionTarget?.dataset?.itemIndex)
				if (!Number.isFinite(itemIndex)) return
				const next = sanitizeHabitBoardState(habitBoardState)
				if (next.boxes[boxIndex].items.length <= 4) return
				next.boxes[boxIndex].items.splice(itemIndex, 1)
				next.boxes[boxIndex].checks.splice(itemIndex, 1)
				saveHabitBoardToStorage(next)
				renderHabitBoard()
				renderHabitBoxesPage()
				return
			}
			if (action === 'toggle-box-square') {
				const itemIndex = Number(actionTarget?.dataset?.itemIndex)
				if (!Number.isFinite(itemIndex)) return
				const next = sanitizeHabitBoardState(habitBoardState)
				next.boxes[boxIndex].checks[itemIndex] = !next.boxes[boxIndex].checks[itemIndex]
				saveHabitBoardToStorage(next)
				renderHabitBoard()
				renderHabitBoxesPage()
			}
		})
		habitBoxesWrap.addEventListener('input', (event) => {
			const target = /** @type {HTMLInputElement | HTMLTextAreaElement} */ (event.target)
			const boxIndex = Number(target?.dataset?.boxIndex)
			if (!Number.isFinite(boxIndex)) return
			const next = sanitizeHabitBoardState(habitBoardState)
			const boxField = String(target?.dataset?.boxField || '')
			if (boxField) {
				next.boxes[boxIndex][boxField] = target.value
				saveHabitBoardToStorage(next)
				syncHabitBoxesLivePreview(next)
				renderHabitBoard()
				return
			}
			const itemIndex = Number(target?.dataset?.itemIndex)
			const itemField = String(target?.dataset?.itemField || '')
			if (!Number.isFinite(itemIndex) || !itemField) return
			next.boxes[boxIndex].items[itemIndex][itemField] = target.value
			saveHabitBoardToStorage(next)
			syncHabitBoxesLivePreview(next)
			renderHabitBoard()
		})
		habitBoxesWrap.addEventListener('change', () => {
			renderHabitBoxesPage()
		})
		habitBoxesWrap.dataset.bound = 'true'
	}

function syncHabitBoxesLivePreview(nextState = sanitizeHabitBoardState(habitBoardState)) {
	if (!habitBoxesWrap) return
	const board = getPrimaryHabitBox(nextState)
	const grid = /** @type {HTMLDivElement | null} */ (habitBoxesWrap.querySelector('[data-habit-box-grid]'))
	if (grid) grid.setAttribute('aria-label', `${board.title || 'Habit board'} squares`)
	for (const [itemIndex, item] of board.items.entries()) {
		const button = /** @type {HTMLButtonElement | null} */ (habitBoxesWrap.querySelector(`[data-preview-item-index="${itemIndex}"]`))
		if (!button) continue
		const iconOut = button.querySelector('.habit-box-square-icon')
		const labelOut = button.querySelector('small')
		if (iconOut) iconOut.textContent = item.icon || String(itemIndex + 1)
		if (labelOut) labelOut.textContent = item.title || `Square ${itemIndex + 1}`
	}
}
}

function renderSettingsPanel(options = {}) {
	if (!settingsWrap) return
	if (!session) {
		settingsWrap.innerHTML = '<div class="habit-gate">Log in to manage your settings.</div>'
		return
	}
	const { skipCloudRefresh = false } = options
	const safeSettings = sanitizeProfileSettings(profileSettings)
	settingsWrap.innerHTML = `
		<form class="settings-form" id="settingsForm">
			<div class="settings-section-card">
				<div class="settings-section-head">
					<div>
						<h3 class="settings-section-title">Profile basics</h3>
						<p class="auth-hint">Keep contact details and goal timing together at the top of the profile.</p>
					</div>
				</div>
				<div class="settings-grid">
					<label class="auth-label">
						<span>Name</span>
						<input id="settingsName" class="auth-input" type="text" maxlength="120" value="${escapeHtml(safeSettings.name || session.name || '')}" />
					</label>
					<label class="auth-label">
						<span>Email</span>
						<input id="settingsEmail" class="auth-input" type="email" maxlength="160" value="${escapeHtml(safeSettings.email || session.email || '')}" />
					</label>
					<label class="auth-label auth-label--wide">
						<span>Contact info</span>
						<textarea id="settingsContactInfo" class="auth-input habit-textarea" rows="3">${escapeHtml(safeSettings.contactInfo)}</textarea>
					</label>
					<label class="auth-label">
						<span>Goal start date</span>
						<input id="settingsGoalStartDate" class="auth-input" type="date" value="${escapeHtml(safeSettings.goalStartDate)}" />
					</label>
					<label class="auth-label">
						<span>Goal end date</span>
						<input id="settingsGoalEndDate" class="auth-input" type="date" value="${escapeHtml(safeSettings.goalEndDate)}" />
					</label>
				</div>
			</div>
			<div class="settings-section-card">
				<div class="settings-section-head">
					<div>
						<h3 class="settings-section-title">Profile snapshot</h3>
						<p class="auth-hint">Capture what this student does well, enjoys, and where they are still growing.</p>
					</div>
				</div>
				<div class="settings-grid settings-grid--profile">
					<label class="auth-label auth-label--wide">
						<span>What I am good at</span>
						<textarea id="settingsGoodAt" class="auth-input habit-textarea" rows="3">${escapeHtml(safeSettings.goodAt)}</textarea>
					</label>
					<label class="auth-label auth-label--wide">
						<span>What I enjoy</span>
						<textarea id="settingsEnjoys" class="auth-input habit-textarea" rows="3">${escapeHtml(safeSettings.enjoys)}</textarea>
					</label>
					<label class="auth-label auth-label--wide">
						<span>Strengths</span>
						<textarea id="settingsStrengths" class="auth-input habit-textarea" rows="4">${escapeHtml(safeSettings.strengths)}</textarea>
					</label>
					<label class="auth-label auth-label--wide">
						<span>Weaknesses</span>
						<textarea id="settingsWeaknesses" class="auth-input habit-textarea" rows="4">${escapeHtml(safeSettings.weaknesses)}</textarea>
					</label>
				</div>
			</div>
			<div class="auth-actions">
				<button class="auth-btn" type="submit">Save settings</button>
			</div>
			<div class="auth-hint">Goal start and end dates sync through AWS. Other profile details still stay local to this device.</div>
			<div class="auth-error" id="settingsMessage" hidden></div>
		</form>
	`
	const settingsForm = document.getElementById('settingsForm')
	applySettingsFormCollapsibleSections(settingsForm)
	const readSettingsFormValues = () => ({
		name: /** @type {HTMLInputElement | null} */ (document.getElementById('settingsName'))?.value,
		email: /** @type {HTMLInputElement | null} */ (document.getElementById('settingsEmail'))?.value,
		contactInfo: /** @type {HTMLTextAreaElement | null} */ (document.getElementById('settingsContactInfo'))?.value,
		goalStartDate: /** @type {HTMLInputElement | null} */ (document.getElementById('settingsGoalStartDate'))?.value,
		goalEndDate: /** @type {HTMLInputElement | null} */ (document.getElementById('settingsGoalEndDate'))?.value,
		goodAt: /** @type {HTMLTextAreaElement | null} */ (document.getElementById('settingsGoodAt'))?.value,
		enjoys: /** @type {HTMLTextAreaElement | null} */ (document.getElementById('settingsEnjoys'))?.value,
		strengths: /** @type {HTMLTextAreaElement | null} */ (document.getElementById('settingsStrengths'))?.value,
		weaknesses: /** @type {HTMLTextAreaElement | null} */ (document.getElementById('settingsWeaknesses'))?.value,
	})
	const persistSettingsDraft = () => {
		saveProfileSettingsToStorage(sanitizeProfileSettings(readSettingsFormValues()))
	}
	settingsForm?.addEventListener('input', () => {
		const settingsMessage = /** @type {HTMLDivElement | null} */ (document.getElementById('settingsMessage'))
		persistSettingsDraft()
		if (settingsMessage) settingsMessage.hidden = true
	})
	settingsForm?.addEventListener('submit', async (event) => {
		event.preventDefault()
		const settingsMessage = /** @type {HTMLDivElement | null} */ (document.getElementById('settingsMessage'))
		const rawSettings = readSettingsFormValues()
		if (parseDateInputToDayMs(rawSettings.goalEndDate) <= parseDateInputToDayMs(rawSettings.goalStartDate)) {
			if (settingsMessage) {
				settingsMessage.textContent = 'End date must be after the start date.'
				settingsMessage.hidden = false
			}
			return
		}
		const nextSettings = sanitizeProfileSettings(rawSettings)
		saveProfileSettingsToStorage(nextSettings)
		let didSyncTimeline = false
		if (session?.token) {
			try {
				await persistProfileGoalTimeline(nextSettings)
				didSyncTimeline = true
			} catch (err) {
				if (settingsMessage) {
					settingsMessage.textContent = `Settings saved locally. Goal timeline did not sync to AWS: ${String(err?.message || 'Unknown error')}`
					settingsMessage.hidden = false
				}
			}
		}
		if (settingsMessage && (didSyncTimeline || !session?.token)) {
			settingsMessage.textContent = didSyncTimeline ? 'Settings saved. Goal timeline synced to AWS.' : 'Settings saved locally.'
			settingsMessage.hidden = false
		}
		if (nextSettings.name && nextSettings.name !== (session?.name || '')) {
			try {
				await persistProfileName(nextSettings.name)
			} catch {
				// Keep the local save even if account sync is unavailable.
			}
		}
		updateAuthUi()
		updateProgress()
		drawDetails()
	})
	if (!skipCloudRefresh && session?.token && !isDesktopApp) {
		void refreshProfileSettingsFromCloud({ rerenderIfVisible: true })
	}
}

function renderInstructorPanel(options = {}) {
	if (!instructorWrap) return
	if (!session) {
		instructorWrap.innerHTML = '<div class="habit-gate">Log in to open the instructor view.</div>'
		return
	}
	if (!isInstructorSession()) {
		instructorWrap.innerHTML = '<div class="habit-gate">Instructor access is only available for instructor accounts.</div>'
		return
	}

	const { skipRefresh = false } = options
	const role = normalizeAccountRole(session.role)
	const students = Array.isArray(instructorDashboardState.students) ? instructorDashboardState.students : []
	const instructors = Array.isArray(instructorDashboardState.instructors) ? instructorDashboardState.instructors : []
	const totalGoal = students.reduce((sum, student) => sum + Math.max(0, Number(student?.goal?.goalDollars) || 0), 0)
	const totalSaved = students.reduce((sum, student) => sum + Math.max(0, Number(student?.goal?.currentSavingsDollars) || 0), 0)
	const rosterSummary = summarizeInstructorRoster(students)
	if (!students.some((student) => normalizeAccountEmail(student?.email) === selectedInstructorStudentEmail)) {
		selectedInstructorStudentEmail = normalizeAccountEmail(students[0]?.email)
	}

	instructorWrap.innerHTML = `<div class="instructor-shell">
		<div class="instructor-panel">
			<div class="instructor-panel-head">
				<div>
					<div class="habit-kicker">${escapeHtml(role === 'super-instructor' ? 'Super Instructor' : 'Instructor')}</div>
					<h3 class="instructor-panel-title">Student goal progress</h3>
					<p class="habit-copy">Review each student's progress here, then open Student Detail for the full meeting view.</p>
				</div>
				<div class="habit-card-chip-row">
					<span class="habit-card-chip">${students.length} student${students.length === 1 ? '' : 's'}</span>
					<span class="habit-card-chip">${formatDollars(totalSaved)} saved</span>
				</div>
			</div>
			<div class="summary-grid summary-grid--compact">
				<div class="metric"><div class="metric-label">Roster Goal</div><div class="metric-value metric-value--small">${formatDollars(totalGoal)}</div></div>
				<div class="metric"><div class="metric-label">Roster Saved</div><div class="metric-value metric-value--small">${formatDollars(totalSaved)}</div></div>
				<div class="metric"><div class="metric-label">Notifications</div><div class="metric-value metric-value--small">${accountNotifications.length}</div></div>
			</div>
			<div class="instructor-risk-grid">
				<div class="instructor-risk-card instructor-risk-card--danger"><div class="instructor-risk-label">At risk</div><div class="instructor-risk-value">${rosterSummary.atRisk}</div></div>
				<div class="instructor-risk-card instructor-risk-card--warning"><div class="instructor-risk-label">Needs support</div><div class="instructor-risk-value">${rosterSummary.needsSupport}</div></div>
				<div class="instructor-risk-card instructor-risk-card--success"><div class="instructor-risk-label">On track</div><div class="instructor-risk-value">${rosterSummary.onTrack}</div></div>
			</div>
			${role === 'super-instructor' && instructors.length ? `<label class="auth-label"><span>Viewing instructor roster</span><select id="superInstructorRosterSelect" class="auth-input">${instructors.map((instructor) => `<option value="${escapeHtml(instructor.email)}" ${normalizeAccountEmail(instructor.email) === selectedInstructorRosterEmail ? 'selected' : ''}>${escapeHtml(instructor.name || instructor.email)} (${escapeHtml(instructor.email)})</option>`).join('')}</select></label>` : ''}
		</div>
		<div class="instructor-panel instructor-panel--compact">
			<div class="instructor-panel-head">
				<div>
					<div class="habit-kicker">Roster</div>
					<h3 class="instructor-panel-title">Assigned students</h3>
					<p class="habit-copy">Select a student to open their complete monthly meeting detail.</p>
				</div>
			</div>
		</div>

		<div class="instructor-student-grid">${students.length ? students.map((student) => {
			const goalDollars = Math.max(0, Number(student?.goal?.goalDollars) || 0)
			const currentSavingsDollars = Math.max(0, Number(student?.goal?.currentSavingsDollars) || 0)
			const completionPct = goalDollars > 0 ? Math.round((currentSavingsDollars / goalDollars) * 100) : 0
			const studentEmail = normalizeAccountEmail(student?.email)
			const isActive = studentEmail === selectedInstructorStudentEmail
			return `<article class="instructor-student-card ${isActive ? 'instructor-student-card--active' : ''}"><div class="instructor-student-head"><div><h3>${escapeHtml(student?.name || student?.email || 'Student')}</h3><div class="metric-note">${escapeHtml(student?.email || '')}</div><div class="metric-note">Instructor: ${escapeHtml(student?.assignedInstructorEmail || 'Unassigned')}</div></div><div class="habit-card-chip-row"><span class="habit-card-chip">${completionPct}% of goal</span><span class="habit-card-chip">${formatDollars(currentSavingsDollars)}</span></div></div><div class="summary-grid summary-grid--compact"><div class="metric"><div class="metric-label">Goal</div><div class="metric-value metric-value--small">${formatDollars(goalDollars)}</div></div><div class="metric"><div class="metric-label">Weekly Reports</div><div class="metric-value metric-value--small">${escapeHtml(String(student?.reports?.weeklyReportCount || 0))}</div></div><div class="metric"><div class="metric-label">Monthly Journals</div><div class="metric-value metric-value--small">${escapeHtml(String(student?.reports?.monthlyJournalCount || 0))}</div></div><div class="metric"><div class="metric-label">Habit Checks</div><div class="metric-value metric-value--small">${escapeHtml(String(student?.habitBoard?.completedChecks || 0))}</div></div></div><div class="instructor-student-details"><div class="breakdown-panel"><h4 class="breakdown-title">Profile Snapshot</h4><ul class="instructor-mini-list"><li>Timeline: ${escapeHtml(student?.profile?.goalStartDate || '--')} to ${escapeHtml(student?.profile?.goalEndDate || '--')}</li><li>Contact: ${escapeHtml(truncateText(student?.profile?.contactInfo || 'No contact info', 90) || 'No contact info')}</li><li>Strengths: ${escapeHtml(truncateText(student?.profile?.strengths || 'Not listed', 90) || 'Not listed')}</li><li>Weaknesses: ${escapeHtml(truncateText(student?.profile?.weaknesses || 'Not listed', 90) || 'Not listed')}</li></ul></div><div class="breakdown-panel"><h4 class="breakdown-title">Recent Activity</h4><ul class="instructor-mini-list"><li>Latest weekly entry: ${escapeHtml(student?.reports?.latestWeeklyReportWeek || '--')}</li><li>Latest journal month: ${escapeHtml(student?.reports?.latestJournalMonth || '--')}</li><li>Notifications: ${escapeHtml(String(Array.isArray(student?.notifications) ? student.notifications.length : 0))}</li></ul><div class="auth-actions"><button type="button" class="auth-btn auth-btn--secondary" data-instructor-student-email="${escapeHtml(studentEmail)}">${isActive ? 'Selected' : 'Select student'}</button><a class="auth-btn auth-btn--secondary" href="#instructor-student" data-instructor-student-email="${escapeHtml(studentEmail)}">View details</a></div></div></div></article>`
		}).join('') : '<div class="habit-gate">No students are assigned yet.</div>'}</div>
	</div>`

	const rosterCards = Array.from(instructorWrap.querySelectorAll('.instructor-student-card'))
	rosterCards.forEach((card, index) => {
		const student = students[index]
		if (!student) return
		card.classList.add('instructor-student-card--compact')
		card.tabIndex = 0
		card.setAttribute('role', 'button')
		card.setAttribute('aria-label', `Open ${student?.name || student?.email || 'student'} detail`)
		const selectStudent = () => {
			selectedInstructorStudentEmail = normalizeAccountEmail(student?.email)
			updateAuthUi()
			location.hash = '#instructor-student'
		}
		card.addEventListener('click', selectStudent)
		card.addEventListener('keydown', (event) => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault()
				selectStudent()
			}
		})
	})

	instructorWrap.querySelectorAll('[data-instructor-student-email]').forEach((node) => {
		node.addEventListener('click', () => {
			selectedInstructorStudentEmail = normalizeAccountEmail(node.getAttribute('data-instructor-student-email'))
			renderInstructorPanel({ skipRefresh: true })
		})
	})

	const rosterSelect = /** @type {HTMLSelectElement | null} */ (document.getElementById('superInstructorRosterSelect'))
	rosterSelect?.addEventListener('change', async () => {
		selectedInstructorRosterEmail = normalizeAccountEmail(rosterSelect.value)
		await refreshInstructorDashboard({ rerenderIfVisible: false })
		renderInstructorPanel({ skipRefresh: true })
	})
	if (!skipRefresh && session?.token && !isDesktopApp) {
		void refreshInstructorDashboard({ rerenderIfVisible: true })
	}
}

function renderInstructorStudentPanel(options = {}) {
	if (!instructorStudentWrap) return
	if (!session || !isInstructorSession()) {
		instructorStudentWrap.innerHTML = '<div class="habit-gate">Open this page from an instructor account.</div>'
		return
	}
	const { skipRefresh = false } = options
	const students = Array.isArray(instructorDashboardState.students) ? instructorDashboardState.students : []
	if (!students.some((student) => normalizeAccountEmail(student?.email) === selectedInstructorStudentEmail)) {
		selectedInstructorStudentEmail = normalizeAccountEmail(students[0]?.email)
	}
	const selectedStudent = students.find((student) => normalizeAccountEmail(student?.email) === selectedInstructorStudentEmail) || null
	if (!selectedStudent) {
		instructorStudentWrap.innerHTML = '<div class="habit-gate">Select a student from the Instructor page first.</div>'
		if (!skipRefresh && session?.token && !isDesktopApp) void refreshInstructorDashboard({ rerenderIfVisible: true })
		return
	}
	const selectedGoalDollars = Math.max(0, Number(selectedStudent?.goal?.goalDollars) || 0)
	const selectedSavingsDollars = Math.max(0, Number(selectedStudent?.goal?.currentSavingsDollars) || 0)
	const selectedCompletionPct = selectedGoalDollars > 0 ? Math.round((selectedSavingsDollars / selectedGoalDollars) * 100) : 0
	const selectedNotifications = Array.isArray(selectedStudent?.notifications) ? selectedStudent.notifications : []
	instructorStudentWrap.innerHTML = `<div class="instructor-shell"><div class="instructor-panel"><div class="instructor-panel-head"><div><div class="habit-kicker">Student Detail</div><h3 class="instructor-panel-title">${escapeHtml(selectedStudent?.name || selectedStudent?.email || 'Student')}</h3><p class="habit-copy">Review profile, progress, report recency, habits, and recent notifications for the currently selected student.</p></div><div class="habit-card-chip-row"><span class="habit-card-chip">${selectedCompletionPct}% of goal</span><span class="habit-card-chip">${formatDollars(selectedSavingsDollars)} saved</span></div></div><div class="instructor-student-picker">${students.map((student) => { const studentEmail = normalizeAccountEmail(student?.email); const isActive = studentEmail === selectedInstructorStudentEmail; return `<button type="button" class="star-toggle star-toggle--compact ${isActive ? 'star-toggle--active' : ''}" data-instructor-student-email="${escapeHtml(studentEmail)}">${escapeHtml(student?.name || student?.email || 'Student')}</button>` }).join('')}</div><div class="instructor-detail-grid"><div class="breakdown-panel"><h4 class="breakdown-title">Profile</h4><ul class="instructor-mini-list"><li>Email: ${escapeHtml(selectedStudent?.email || '--')}</li><li>Assigned instructor: ${escapeHtml(selectedStudent?.assignedInstructorEmail || 'Unassigned')}</li><li>Goal timeline: ${escapeHtml(selectedStudent?.profile?.goalStartDate || '--')} to ${escapeHtml(selectedStudent?.profile?.goalEndDate || '--')}</li><li>Contact: ${formatHabitText(selectedStudent?.profile?.contactInfo || 'No contact info yet.')}</li></ul></div><div class="breakdown-panel"><h4 class="breakdown-title">Strengths</h4><div class="metric-note">${formatHabitText(selectedStudent?.profile?.strengths || 'No strengths listed yet.')}</div></div><div class="breakdown-panel"><h4 class="breakdown-title">Weaknesses</h4><div class="metric-note">${formatHabitText(selectedStudent?.profile?.weaknesses || 'No weaknesses listed yet.')}</div></div><div class="breakdown-panel"><h4 class="breakdown-title">Financial Snapshot</h4><ul class="instructor-mini-list"><li>Goal amount: ${formatDollars(selectedGoalDollars)}</li><li>Current savings: ${formatDollars(selectedSavingsDollars)}</li><li>Weekly savings: ${formatDollars(selectedStudent?.financial?.weekly?.savingsDollars || 0)}</li><li>Monthly savings: ${formatDollars(selectedStudent?.financial?.monthly?.savingsDollars || 0)}</li><li>Yearly savings: ${formatDollars(selectedStudent?.financial?.yearly?.savingsDollars || 0)}</li><li>Weekly margin: ${formatSignedDollars(selectedStudent?.financial?.weekly?.marginDollars || 0)}</li></ul></div><div class="breakdown-panel"><h4 class="breakdown-title">Activity</h4><ul class="instructor-mini-list"><li>Weekly reports: ${escapeHtml(String(selectedStudent?.reports?.weeklyReportCount || 0))}</li><li>Monthly journals: ${escapeHtml(String(selectedStudent?.reports?.monthlyJournalCount || 0))}</li><li>Latest weekly entry: ${escapeHtml(selectedStudent?.reports?.latestWeeklyReportWeek || '--')}</li><li>Latest journal month: ${escapeHtml(selectedStudent?.reports?.latestJournalMonth || '--')}</li><li>Habit checks done: ${escapeHtml(String(selectedStudent?.habitBoard?.completedChecks || 0))}</li><li>Weeks tracked: ${escapeHtml(String(selectedStudent?.habitBoard?.weeksTracked || 0))}</li></ul></div><div class="breakdown-panel report-block--full"><div class="report-block-head"><h4 class="breakdown-title">Recent Notifications</h4><span class="metric-note">${escapeHtml(String(selectedNotifications.length))} saved</span></div>${selectedNotifications.length ? `<div class="instructor-notification-list">${selectedNotifications.slice(0, 5).map((item) => `<div class="instructor-note"><div class="instructor-note-head"><strong>${escapeHtml(item?.senderEmail || 'Instructor')}</strong><span>${Number(item?.createdAtMs) > 0 ? escapeHtml(new Date(Number(item.createdAtMs)).toLocaleString()) : ''}</span></div><p>${formatHabitText(item?.message || '')}</p></div>`).join('')}</div>` : '<div class="metric-note">No notifications have been sent to this student yet.</div>'}</div></div></div></div>`
	const profilePanel = instructorStudentWrap.querySelector('.instructor-detail-grid .breakdown-panel')
	if (profilePanel) {
		const profileList = profilePanel.querySelector('.instructor-mini-list')
		profileList?.insertAdjacentHTML('beforeend', `<li>Good at: ${formatHabitText(selectedStudent?.profile?.goodAt || 'No strengths-in-practice listed yet.')}</li><li>Enjoys: ${formatHabitText(selectedStudent?.profile?.enjoys || 'No interests listed yet.')}</li>`)
	}
	enhanceInstructorStudentLayout(selectedStudent)
	const detailHeaderActions = instructorStudentWrap.querySelector('.instructor-panel-head .habit-card-chip-row')
	detailHeaderActions?.insertAdjacentHTML('beforeend', '<button type="button" class="auth-btn auth-btn--secondary" id="exportInstructorRosterBtn">Export roster</button>')

	instructorStudentWrap.querySelectorAll('[data-instructor-student-email]').forEach((node) => {
		node.addEventListener('click', () => {
			selectedInstructorStudentEmail = normalizeAccountEmail(node.getAttribute('data-instructor-student-email'))
			renderInstructorStudentPanel({ skipRefresh: true })
		})
	})
	const exportInstructorRosterBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('exportInstructorRosterBtn'))
	exportInstructorRosterBtn?.addEventListener('click', exportInstructorRosterCsv)
	const checkInForm = /** @type {HTMLFormElement | null} */ (document.getElementById('instructorCheckInForm'))
	checkInForm?.addEventListener('submit', (event) => {
		event.preventDefault()
		const messageNode = /** @type {HTMLDivElement | null} */ (document.getElementById('instructorCheckInMessage'))
		const nextCheckIn = {
			status: normalizeAccountRole((/** @type {HTMLSelectElement | null} */ (document.getElementById('instructorCheckInStatus'))?.value) || 'needs-support') === 'student' ? 'needs-support' : ((/** @type {HTMLSelectElement | null} */ (document.getElementById('instructorCheckInStatus'))?.value) || 'needs-support'),
			focus: String((/** @type {HTMLTextAreaElement | null} */ (document.getElementById('instructorCheckInFocus'))?.value) || '').trim(),
			progress: String((/** @type {HTMLTextAreaElement | null} */ (document.getElementById('instructorCheckInProgress'))?.value) || '').trim(),
			blockers: String((/** @type {HTMLTextAreaElement | null} */ (document.getElementById('instructorCheckInBlockers'))?.value) || '').trim(),
			support: String((/** @type {HTMLTextAreaElement | null} */ (document.getElementById('instructorCheckInSupport'))?.value) || '').trim(),
		}
		saveInstructorCheckIn(selectedStudent?.email, nextCheckIn)
		if (messageNode) {
			messageNode.textContent = 'Monthly prep saved.'
			messageNode.hidden = false
		}
		renderInstructorStudentPanel({ skipRefresh: true })
	})
	if (!skipRefresh && session?.token && !isDesktopApp) {
		void refreshInstructorDashboard({ rerenderIfVisible: true })
	}
}

function renderSuperAdminPanel(options = {}) {
	if (!superAdminWrap) return
	if (!session || !isSuperInstructorSession()) {
		superAdminWrap.innerHTML = '<div class="habit-gate">Super admin tools are only available for the super-instructor account.</div>'
		return
	}
	const { skipRefresh = false } = options
	const instructors = Array.isArray(instructorDashboardState.instructors) ? instructorDashboardState.instructors : []
	const students = Array.isArray(instructorDashboardState.allStudents) && instructorDashboardState.allStudents.length
		? instructorDashboardState.allStudents
		: Array.isArray(instructorDashboardState.students) ? instructorDashboardState.students : []
	const selectedInstructorValue = normalizeAccountEmail(selectedInstructorRosterEmail) || normalizeAccountEmail(instructors[0]?.email || '')
	const selectedStudentEmails = new Set(
		students
			.filter((student) => normalizeAccountEmail(student?.assignedInstructorEmail) === selectedInstructorValue)
			.map((student) => normalizeAccountEmail(student?.email))
			.filter(Boolean)
	)
	const unassignedStudents = students.filter((student) => !normalizeAccountEmail(student?.assignedInstructorEmail))
	const assignmentHistory = students
		.flatMap((student) => (Array.isArray(student?.assignmentHistory) ? student.assignmentHistory : []).map((entry) => ({
			...entry,
			studentName: student?.name || student?.email || 'Student',
			studentEmail: normalizeAccountEmail(student?.email),
		})))
		.filter((entry) => Number(entry?.assignedAtMs) > 0)
		.sort((a, b) => Number(b.assignedAtMs) - Number(a.assignedAtMs))
		.slice(0, 12)
	superAdminWrap.innerHTML = `<div class="instructor-shell"><div class="instructor-action-grid"><form class="instructor-panel instructor-form" id="instructorAssignForm"><div class="instructor-panel-head"><div><div class="habit-kicker">Assignments</div><h3 class="instructor-panel-title">Assign students to an instructor</h3></div></div><label class="auth-label"><span>Instructor</span><input id="assignInstructorSearch" class="auth-input" type="text" placeholder="Search instructors" /><select id="assignInstructorSelect" class="auth-input">${instructors.length ? instructors.map((instructor) => `<option value="${escapeHtml(instructor.email)}" ${normalizeAccountEmail(instructor.email) === selectedInstructorValue ? 'selected' : ''}>${escapeHtml(instructor.name || instructor.email)} (${escapeHtml(instructor.email)})</option>`).join('') : '<option value="">No instructors available</option>'}</select></label><div class="auth-label auth-label--wide"><span>Students</span><input id="assignStudentSearch" class="auth-input" type="text" placeholder="Search students by name or email" /><div class="super-admin-option-list">${students.length ? students.map((student) => {
		const email = normalizeAccountEmail(student?.email)
		const selectedState = selectedStudentEmails.has(email)
		return `<button type="button" class="super-admin-option ${selectedState ? 'super-admin-option--selected' : ''}" data-select-student-email="${escapeHtml(email)}" aria-pressed="${selectedState ? 'true' : 'false'}"><span><span class="super-admin-option-name">${escapeHtml(student?.name || student?.email || 'Student')}</span><span class="super-admin-option-meta">${escapeHtml(student?.email || '')}</span></span><span class="super-admin-option-status">${selectedState ? 'Selected' : 'Add'}</span></button>`
	}).join('') : '<div class="habit-empty">No students available.</div>'}</div><div class="super-admin-chips" id="assignStudentChips">${selectedStudentEmails.size ? Array.from(selectedStudentEmails).map((email) => `<span class="super-admin-chip">${escapeHtml(email)}</span>`).join('') : '<span class="habit-empty">No students selected.</span>'}</div></div><div class="auth-actions"><button type="submit" class="auth-btn">Save roster</button></div><div class="auth-error" id="assignStudentsMessage" hidden></div></form><form class="instructor-panel instructor-form" id="instructorCreateForm"><div class="instructor-panel-head"><div><div class="habit-kicker">Accounts</div><h3 class="instructor-panel-title">Create an instructor account</h3></div></div><label class="auth-label"><span>Instructor name</span><input id="createInstructorName" class="auth-input" type="text" placeholder="Instructor name" /></label><label class="auth-label"><span>Instructor email</span><input id="createInstructorEmail" class="auth-input" type="email" placeholder="instructor@example.com" /></label><label class="auth-label"><span>Temporary password</span><input id="createInstructorPassword" class="auth-input" type="password" placeholder="Create a starter password" /></label><div class="auth-actions"><button type="submit" class="auth-btn">Create instructor</button></div><div class="auth-error" id="createInstructorMessage" hidden></div></form><form class="instructor-panel instructor-form" id="instructorNotificationForm"><div class="instructor-panel-head"><div><div class="habit-kicker">Notification</div><h3 class="instructor-panel-title">Send a check-in note</h3></div></div><label class="auth-label"><span>Instructor roster</span><select id="superAdminNotificationRoster" class="auth-input">${instructors.map((instructor) => `<option value="${escapeHtml(instructor.email)}" ${normalizeAccountEmail(instructor.email) === selectedInstructorValue ? 'selected' : ''}>${escapeHtml(instructor.name || instructor.email)} (${escapeHtml(instructor.email)})</option>`).join('')}</select></label><label class="auth-label auth-label--wide"><span>Message</span><textarea id="notificationMessage" class="auth-input habit-textarea" rows="4" placeholder="Share any check-in reminder or coaching note"></textarea></label><div class="auth-actions"><button type="submit" class="auth-btn">Send note</button></div><div class="auth-error" id="notificationMessageStatus" hidden></div></form></div></div>`
	const superAdminShell = superAdminWrap.querySelector('.instructor-shell')
	superAdminShell?.insertAdjacentHTML('afterbegin', `<div class="super-admin-operations"><section class="instructor-panel super-admin-queue"><div class="instructor-panel-head"><div><div class="habit-kicker">Needs assignment</div><h3 class="instructor-panel-title">Unassigned students</h3><p class="habit-copy">Select a student here, choose an instructor below, then save the roster.</p></div><span class="habit-card-chip">${unassignedStudents.length}</span></div><div class="super-admin-option-list">${unassignedStudents.length ? unassignedStudents.map((student) => { const email = normalizeAccountEmail(student?.email); const selectedState = selectedStudentEmails.has(email); return `<button type="button" class="super-admin-option ${selectedState ? 'super-admin-option--selected' : ''}" data-select-student-email="${escapeHtml(email)}" aria-pressed="${selectedState ? 'true' : 'false'}"><span><span class="super-admin-option-name">${escapeHtml(student?.name || student?.email || 'Student')}</span><span class="super-admin-option-meta">${escapeHtml(student?.email || '')}</span></span><span class="super-admin-option-status">${selectedState ? 'Selected' : 'Select'}</span></button>` }).join('') : '<div class="habit-empty">Every student has an instructor.</div>'}</div></section><section class="instructor-panel super-admin-history"><div class="instructor-panel-head"><div><div class="habit-kicker">Activity</div><h3 class="instructor-panel-title">Assignment history</h3></div></div><div class="super-admin-history-list">${assignmentHistory.length ? assignmentHistory.map((entry) => `<article class="super-admin-history-item"><div><strong>${escapeHtml(entry.studentName)}</strong><div class="super-admin-option-meta">${escapeHtml(entry.instructorEmail ? (entry.previousInstructorEmail ? `${entry.previousInstructorEmail} to ${entry.instructorEmail}` : `Assigned to ${entry.instructorEmail}`) : `Unassigned from ${entry.previousInstructorEmail || 'instructor'}`)}</div><div class="super-admin-option-meta">By ${escapeHtml(entry.assignedByEmail || 'Super instructor')}</div></div><time class="super-admin-option-meta">${escapeHtml(formatDateLabel(entry.assignedAtMs))}</time></article>`).join('') : '<div class="habit-empty">No assignment changes recorded yet.</div>'}</div></section></div>`)
	const assignForm = document.getElementById('instructorAssignForm')
	const assignInstructorSelect = /** @type {HTMLSelectElement | null} */ (document.getElementById('assignInstructorSelect'))
	const assignInstructorSearch = /** @type {HTMLInputElement | null} */ (document.getElementById('assignInstructorSearch'))
	const assignStudentSearch = /** @type {HTMLInputElement | null} */ (document.getElementById('assignStudentSearch'))
	const assignStudentOptions = /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('[data-select-student-email]'))
	const assignStudentChips = /** @type {HTMLDivElement | null} */ (document.getElementById('assignStudentChips'))
	const syncStudentSelectionUi = () => {
		if (!assignStudentChips) return
		const selected = Array.from(selectedStudentEmails)
		assignStudentChips.innerHTML = selected.length
			? selected.map((email) => `<span class="super-admin-chip">${escapeHtml(email)}</span>`).join('')
			: '<span class="habit-empty">No students selected.</span>'
		assignStudentOptions.forEach((button) => {
			const email = normalizeAccountEmail(button.getAttribute('data-select-student-email') || '')
			const selectedState = selectedStudentEmails.has(email)
			button.classList.toggle('super-admin-option--selected', selectedState)
			button.setAttribute('aria-pressed', String(selectedState))
			const statusNode = button.querySelector('.super-admin-option-status')
			if (statusNode) statusNode.textContent = selectedState ? 'Selected' : 'Add'
		})
	}
	assignStudentOptions.forEach((button) => {
		button.addEventListener('click', () => {
			const email = normalizeAccountEmail(button.getAttribute('data-select-student-email') || '')
			if (!email) return
			if (selectedStudentEmails.has(email)) selectedStudentEmails.delete(email)
			else selectedStudentEmails.add(email)
			syncStudentSelectionUi()
		})
	})
	assignStudentSearch?.addEventListener('input', () => {
		const term = String(assignStudentSearch.value || '').trim().toLowerCase()
		assignStudentOptions.forEach((button) => {
			const email = normalizeAccountEmail(button.getAttribute('data-select-student-email') || '')
			const label = (button.textContent || '').toLowerCase()
			const matches = !term || label.includes(term) || email.includes(term)
			button.hidden = !matches
		})
	})
	assignInstructorSearch?.addEventListener('input', () => {
		const term = String(assignInstructorSearch.value || '').trim().toLowerCase()
		Array.from(assignInstructorSelect?.options || []).forEach((option) => {
			const matches = !term || (option.textContent || '').toLowerCase().includes(term) || (option.value || '').toLowerCase().includes(term)
			option.hidden = !matches
		})
	})
	if (assignInstructorSelect) assignInstructorSelect.value = selectedInstructorValue
	syncStudentSelectionUi()
	assignForm?.addEventListener('submit', async (event) => {
		event.preventDefault()
		const messageNode = /** @type {HTMLDivElement | null} */ (document.getElementById('assignStudentsMessage'))
		const instructorEmail = normalizeAccountEmail(assignInstructorSelect?.value || '')
		const studentEmails = Array.from(selectedStudentEmails)
		if (!instructorEmail || !session?.token) {
			if (messageNode) {
				messageNode.textContent = 'Select an instructor before saving the roster.'
				messageNode.hidden = false
			}
			return
		}
		try {
			await cloudAssignStudents({ token: session.token, instructorEmail, studentEmails })
			selectedInstructorRosterEmail = instructorEmail
			await refreshInstructorDashboard({ rerenderIfVisible: false })
			if (messageNode) {
				messageNode.textContent = 'Roster updated.'
				messageNode.hidden = false
			}
			renderSuperAdminPanel({ skipRefresh: true })
		} catch (err) {
			if (messageNode) {
				messageNode.textContent = String(err?.message || 'Unable to update the roster.')
				messageNode.hidden = false
			}
		}
	})
	const createForm = document.getElementById('instructorCreateForm')
	createForm?.addEventListener('submit', async (event) => {
		event.preventDefault()
		const messageNode = /** @type {HTMLDivElement | null} */ (document.getElementById('createInstructorMessage'))
		const email = normalizeAccountEmail((/** @type {HTMLInputElement | null} */ (document.getElementById('createInstructorEmail'))?.value) || '')
		const name = String((/** @type {HTMLInputElement | null} */ (document.getElementById('createInstructorName'))?.value) || '').trim()
		const password = String((/** @type {HTMLInputElement | null} */ (document.getElementById('createInstructorPassword'))?.value) || '')
		if (!email || !password || !session?.token) {
			if (messageNode) {
				messageNode.textContent = 'Enter an instructor email and temporary password.'
				messageNode.hidden = false
			}
			return
		}
		try {
			await cloudCreateInstructorAccount({ token: session.token, email, name, password })
			selectedInstructorRosterEmail = email
			await refreshInstructorDashboard({ rerenderIfVisible: false })
			if (messageNode) {
				messageNode.textContent = 'Instructor account created.'
				messageNode.hidden = false
			}
			renderSuperAdminPanel({ skipRefresh: true })
		} catch (err) {
			if (messageNode) {
				messageNode.textContent = String(err?.message || 'Unable to create the instructor account.')
				messageNode.hidden = false
			}
		}
	})
	const notificationForm = document.getElementById('instructorNotificationForm')
	notificationForm?.addEventListener('submit', async (event) => {
		event.preventDefault()
		const statusNode = /** @type {HTMLDivElement | null} */ (document.getElementById('notificationMessageStatus'))
		const message = String((/** @type {HTMLTextAreaElement | null} */ (document.getElementById('notificationMessage'))?.value) || '').trim()
		const targetRoster = normalizeAccountEmail((/** @type {HTMLSelectElement | null} */ (document.getElementById('superAdminNotificationRoster'))?.value) || selectedInstructorRosterEmail)
		if (!message || !session?.token) {
			if (statusNode) {
				statusNode.textContent = 'Write a message before sending.'
				statusNode.hidden = false
			}
			return
		}
		try {
			await cloudSendInstructorNotification({ token: session.token, message, instructorEmail: targetRoster })
			if (statusNode) {
				statusNode.textContent = 'Notification sent.'
				statusNode.hidden = false
			}
			selectedInstructorRosterEmail = targetRoster
			await hydrateAccountFromCloud()
			updateAuthUi()
		} catch (err) {
			if (statusNode) {
				statusNode.textContent = String(err?.message || 'Unable to send the notification.')
				statusNode.hidden = false
			}
		}
	})
	if (!skipRefresh && session?.token && !isDesktopApp) {
		void refreshInstructorDashboard({ rerenderIfVisible: true })
	}
}

function getPeriodBounds(kind, anchorDayMs) {
	const anchor = startOfLocalDayMs(new Date(anchorDayMs))
	if (kind === 'week') {
		const startMs = startOfLocalWeekMs(new Date(anchor))
		const endMs = startMs + 7 * DAY_MS
		return {
			startMs,
			endMs,
			rangeText: `${formatShortDate(startMs)} – ${formatShortDate(endMs - DAY_MS)}`,
		}
	}
	if (kind === 'year') {
		const y = new Date(anchor).getFullYear()
		const startMs = startOfLocalDayMs(new Date(y, 0, 1))
		const endMs = startOfLocalDayMs(new Date(y + 1, 0, 1))
		return { startMs, endMs, rangeText: String(y) }
	}
	// month
	const startMs = startOfLocalMonthMs(new Date(anchor))
	const endMs = addMonthsMs(startMs, 1)
	return { startMs, endMs, rangeText: formatMonthLabel(startMs) }
}

function shiftAnchor(kind, anchorDayMs, delta) {
	const d = new Date(startOfLocalDayMs(new Date(anchorDayMs)))
	if (kind === 'week') d.setDate(d.getDate() + delta * 7)
	else if (kind === 'month') d.setMonth(d.getMonth() + delta)
	else d.setFullYear(d.getFullYear() + delta)
	return startOfLocalDayMs(d)
}

function buildPeriodSeries(kind, anchorDayMs) {
	const { startMs, endMs, rangeText } = getPeriodBounds(kind, anchorDayMs)

	/** @type {string[]} */
	let labels = []
	let buckets = 0

	if (kind === 'week') {
		buckets = 7
		labels = new Array(7).fill(0).map((_, i) => formatShortDate(startMs + i * DAY_MS))
	} else if (kind === 'year') {
		buckets = 12
		labels = new Array(12).fill(0).map((_, i) => new Date(2000, i, 1).toLocaleDateString(undefined, { month: 'short' }))
	} else {
		const d = new Date(startMs)
		const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() || 30
		buckets = daysInMonth
		labels = new Array(daysInMonth).fill(0).map((_, i) => String(i + 1))
	}

	const income = new Array(buckets).fill(0)
	const expenses = new Array(buckets).fill(0)
	const savings = new Array(buckets).fill(0)

	for (const e of ledgerEntries) {
		const dayMs = Number(e?.dayMs)
		if (!Number.isFinite(dayMs)) continue
		if (dayMs < startMs || dayMs >= endMs) continue
		let idx = 0
		if (kind === 'year') {
			idx = new Date(dayMs).getMonth()
		} else {
			idx = Math.floor((dayMs - startMs) / DAY_MS)
		}
		if (idx < 0 || idx >= buckets) continue
		income[idx] += Math.max(0, Number(e?.incomeDollars) || 0)
		expenses[idx] += Math.max(0, Number(e?.expensesDollars) || 0)
		savings[idx] += Math.max(0, Number(e?.savingsDollars) || 0)
	}

	const totals = {
		incomeDollars: income.reduce((a, b) => a + b, 0),
		expensesDollars: expenses.reduce((a, b) => a + b, 0),
		savingsDollars: savings.reduce((a, b) => a + b, 0),
	}

	return {
		labels,
		rangeText,
		totals,
		series: [
			{ key: 'income', values: income },
			{ key: 'expenses', values: expenses },
			{ key: 'savings', values: savings },
		],
	}
}

function drawDetailChart(kind, canvas, tooltip, rangeOut) {
	if (!canvas) return
	const ctx = canvas.getContext('2d')
	if (!ctx) return

	const rect = canvas.getBoundingClientRect()
	if (rect.width <= 0 || rect.height <= 0) return

	const dpr = Math.max(1, window.devicePixelRatio || 1)
	const width = Math.round(rect.width * dpr)
	const height = Math.round(rect.height * dpr)
	if (canvas.width !== width) canvas.width = width
	if (canvas.height !== height) canvas.height = height

	ctx.setTransform(1, 0, 0, 1, 0, 0)
	ctx.scale(dpr, dpr)

	const w = rect.width
	const h = rect.height
	ctx.clearRect(0, 0, w, h)

	const padL = 44
	const padR = 14
	const padT = 12
	const padB = 26
	const plotW = Math.max(1, w - padL - padR)
	const plotH = Math.max(1, h - padT - padB)

	const rootStyle = getComputedStyle(document.documentElement)
	const accent = rootStyle.getPropertyValue('--accent').trim() || '#f97316'
	const axis = rootStyle.getPropertyValue('--border').trim() || 'rgba(15, 23, 42, 0.22)'
	const text = rootStyle.getPropertyValue('--text').trim() || 'rgba(15, 23, 42, 0.65)'
	const textH = rootStyle.getPropertyValue('--text-h').trim() || 'rgba(15, 23, 42, 0.85)'

	const { labels, series, rangeText } = buildPeriodSeries(kind, detailAnchorDayMs)
	if (rangeOut) rangeOut.textContent = rangeText

	const allValues = []
	for (const s of series) for (const v of s.values) allValues.push(Number(v) || 0)
	const minV = Math.min(0, ...allValues)
	const maxV = Math.max(0, ...allValues)
	const span = Math.max(1, maxV - minV)

	const yFor = (v) => {
		const pct = (v - minV) / span
		return padT + (1 - clamp(pct, 0, 1)) * plotH
	}
	const xForIndex = (i) => {
		const pct = labels.length <= 1 ? 0 : i / (labels.length - 1)
		return padL + clamp(pct, 0, 1) * plotW
	}

	/** @type {number[]} */
	const x = labels.map((_, i) => xForIndex(i))

	// Axes
	ctx.strokeStyle = axis
	ctx.lineWidth = 1
	ctx.beginPath()
	ctx.moveTo(padL, padT)
	ctx.lineTo(padL, padT + plotH)
	ctx.lineTo(padL + plotW, padT + plotH)
	ctx.stroke()

	// Zero line
	const y0 = yFor(0)
	ctx.save()
	ctx.globalAlpha = 0.45
	ctx.setLineDash([6, 6])
	ctx.beginPath()
	ctx.moveTo(padL, y0)
	ctx.lineTo(padL + plotW, y0)
	ctx.stroke()
	ctx.restore()

	// Series styles
	/** @type {Record<string, { stroke: string, dash: number[], alpha: number, width: number }>} */
	const styleByKey = {
		income: { stroke: textH, dash: [6, 6], alpha: 0.9, width: 2 },
		expenses: { stroke: text, dash: [2, 6], alpha: 0.9, width: 2 },
		savings: { stroke: accent, dash: [], alpha: 1, width: 2.5 },
	}

	/** @type {Array<{ key: string, values: number[], points: Array<{ x: number, y: number, v: number }> }>} */
	const seriesWithPoints = []
	for (const s of series) {
		const values = s.values.map((v) => Number(v) || 0)
		const points = values.map((v, i) => ({ x: x[i], y: yFor(v), v }))
		seriesWithPoints.push({ key: s.key, values, points })

		const st = styleByKey[s.key] || styleByKey.savings
		ctx.save()
		ctx.globalAlpha = st.alpha
		ctx.strokeStyle = st.stroke
		ctx.lineWidth = st.width
		ctx.lineJoin = 'round'
		ctx.lineCap = 'round'
		ctx.setLineDash(st.dash)
		ctx.beginPath()
		for (let i = 0; i < points.length; i++) {
			const p = points[i]
			if (i === 0) ctx.moveTo(p.x, p.y)
			else ctx.lineTo(p.x, p.y)
		}
		ctx.stroke()
		ctx.restore()
	}

	// X ticks (keep it sparse)
	ctx.fillStyle = text
	ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif'
	ctx.textBaseline = 'alphabetic'
	const baselineY = padT + plotH
	const maxTicks = 6
	const step = Math.max(1, Math.ceil(labels.length / maxTicks))
	for (let i = 0; i < labels.length; i += step) {
		const xi = x[i]
		ctx.strokeStyle = axis
		ctx.lineWidth = 1
		ctx.beginPath()
		ctx.moveTo(xi, baselineY)
		ctx.lineTo(xi, baselineY + 5)
		ctx.stroke()

		ctx.textAlign = i === 0 ? 'left' : (i + step >= labels.length ? 'right' : 'center')
		ctx.fillText(labels[i], xi, baselineY + 18)
	}

	// Y labels (min/0/max)
	ctx.textAlign = 'right'
	ctx.fillStyle = text
	ctx.fillText(formatSignedDollars(minV), padL - 8, yFor(minV) + 4)
	ctx.fillStyle = textH
	ctx.fillText('$0', padL - 8, y0 + 4)
	ctx.fillStyle = text
	ctx.fillText(formatSignedDollars(maxV), padL - 8, yFor(maxV) + 4)

	detailChartState = {
		canvasW: w,
		canvasH: h,
		padL,
		padT,
		plotW,
		plotH,
		labels,
		x,
		series: seriesWithPoints,
	}
}

function hideDetailTooltip(tooltip) {
	if (!tooltip) return
	tooltip.hidden = true
}

function onDetailPointerMove(canvas, tooltip, e) {
	if (!canvas || !tooltip) return
	const state = detailChartState
	if (!state || state.labels.length === 0) {
		hideDetailTooltip(tooltip)
		return
	}

	const r = canvas.getBoundingClientRect()
	const x = e.clientX - r.left
	const y = e.clientY - r.top
	if (x < 0 || y < 0 || x > r.width || y > r.height) {
		hideDetailTooltip(tooltip)
		return
	}

	let bestI = 0
	let bestDist = Infinity
	for (let i = 0; i < state.x.length; i++) {
		const d = Math.abs(state.x[i] - x)
		if (d < bestDist) {
			bestDist = d
			bestI = i
		}
	}

	const label = state.labels[bestI] || ''
	const income = state.series.find((s) => s.key === 'income')?.values[bestI] ?? 0
	const expenses = state.series.find((s) => s.key === 'expenses')?.values[bestI] ?? 0
	const savings = state.series.find((s) => s.key === 'savings')?.values[bestI] ?? 0
	tooltip.textContent = `${label} — Income ${formatDollars(income)} · Expenses ${formatDollars(expenses)} · Savings ${formatDollars(savings)}`

	// Anchor tooltip near the savings point.
	const savingsPoint = state.series.find((s) => s.key === 'savings')?.points[bestI]
	const anchorX = savingsPoint ? savingsPoint.x : state.x[bestI]
	const anchorY = savingsPoint ? savingsPoint.y : (state.padT + state.plotH / 2)

	tooltip.hidden = false
	const canvasLeft = canvas.offsetLeft
	const canvasTop = canvas.offsetTop
	const tipW = tooltip.offsetWidth || 0
	const left = canvasLeft + anchorX
	const top = canvasTop + anchorY
	const minLeft = canvasLeft + tipW / 2 + 6
	const maxLeft = canvasLeft + state.canvasW - tipW / 2 - 6
	const clampedLeft = tipW > 0 ? clamp(left, minLeft, maxLeft) : left
	tooltip.style.left = `${clampedLeft}px`
	tooltip.style.top = `${top}px`

	const tipH = tooltip.offsetHeight || 0
	tooltip.classList.toggle('chart-tooltip--bottom', anchorY < tipH + 18)
}

function updateDetailsTotals() {
	if (!detailIncomeTotalOut || !detailExpensesTotalOut || !detailSavingsTotalOut) return
	if (!session) {
		detailIncomeTotalOut.textContent = '$0'
		detailExpensesTotalOut.textContent = '$0'
		detailSavingsTotalOut.textContent = '$0'
		return
	}
	const { totals } = buildPeriodSeries(detailKind, detailAnchorDayMs)
	detailIncomeTotalOut.textContent = formatDollars(totals.incomeDollars)
	detailExpensesTotalOut.textContent = formatDollars(totals.expensesDollars)
	detailSavingsTotalOut.textContent = formatDollars(totals.savingsDollars)
	renderFundSummary()
	renderEntryFeed()
}

function getFinancialDraftValues() {
	const income = Math.max(0, Math.round(Number(entryIncomeInput?.value) || 0))
	const expenses = Math.max(0, Math.round(Number(entryExpensesInput?.value) || 0))
	const net = income - expenses
	const savings = Math.max(0, net)
	return { income, expenses, net, savings }
}

function setRangePercent(rangeNode) {
	if (!rangeNode) return 0
	const min = Number(rangeNode.min || 0)
	const max = Number(rangeNode.max || 100)
	const value = Number(rangeNode.value || min)
	const span = Math.max(1, max - min)
	const pct = clamp(((value - min) / span) * 100, 0, 100)
	rangeNode.style.setProperty('--range-pct', `${pct}%`)
	return pct
}

function syncFinancialProgressUi() {
	const { income, expenses, net, savings } = getFinancialDraftValues()
	const incomePct = setRangePercent(entryIncomeInput)
	const expensesPct = setRangePercent(entryExpensesInput)
	if (entryIncomeValueOut) entryIncomeValueOut.textContent = formatDollars(income)
	if (entryExpensesValueOut) entryExpensesValueOut.textContent = formatDollars(expenses)
	if (entryIncomePositionOut) entryIncomePositionOut.textContent = `${Math.round(incomePct)}%`
	if (entryExpensesPositionOut) entryExpensesPositionOut.textContent = `${Math.round(expensesPct)}%`
	if (progressIncomeValueOut) progressIncomeValueOut.textContent = formatDollars(income)
	if (progressExpensesValueOut) progressExpensesValueOut.textContent = formatDollars(expenses)
	if (progressNetValueOut) progressNetValueOut.textContent = formatSignedDollars(net)
	if (entrySavingsInput) entrySavingsInput.value = String(savings)
	const pct = income > 0 ? clamp((savings / income) * 100, 0, 100) : 0
	if (entryProgressPctOut) entryProgressPctOut.textContent = `${Math.round(pct)}%`
	if (entryProgressBar) entryProgressBar.style.width = `${pct}%`
	renderEntryAllocationDrafts()
}

function sumAllocationDraft(map) {
	return Object.values(map || {}).reduce((sum, amount) => sum + Math.max(0, Math.round(Number(amount) || 0)), 0)
}

function renderEntryAllocationDrafts() {
	const { income, expenses } = getFinancialDraftValues()
	const incomeTotal = sumAllocationDraft(incomeAllocationDraft)
	const expenseTotal = sumAllocationDraft(expenseAllocationDraft)
	if (incomeAllocationTotal) {
		incomeAllocationTotal.textContent = `Allocated: ${formatDollars(incomeTotal)} of ${formatDollars(income)}`
	}
	if (expenseAllocationTotal) {
		expenseAllocationTotal.textContent = `Allocated: ${formatDollars(expenseTotal)} of ${formatDollars(expenses)}`
	}
	if (incomeAllocationList) {
		const rows = Object.entries(incomeAllocationDraft).filter(([, amount]) => Number(amount) > 0)
		incomeAllocationList.innerHTML = rows.length
			? rows.map(([name, amount]) => `<button type="button" class="habit-card-chip details-category-chip" data-remove-income-allocation="${escapeHtml(name)}">${escapeHtml(name)}: ${formatDollars(amount)}</button>`).join('')
			: '<div class="breakdown-empty">No income allocations yet.</div>'
	}
	if (expenseAllocationList) {
		const rows = Object.entries(expenseAllocationDraft).filter(([, amount]) => Number(amount) > 0)
		expenseAllocationList.innerHTML = rows.length
			? rows.map(([name, amount]) => `<button type="button" class="habit-card-chip details-category-chip" data-remove-expense-allocation="${escapeHtml(name)}">${escapeHtml(name)}: ${formatDollars(amount)}</button>`).join('')
			: '<div class="breakdown-empty">No expense allocations yet.</div>'
	}
}

function renderExpenseCategoryOptions() {
	if (!entryExpenseCategoryInput) return
	const selected = String(entryExpenseCategoryInput.value || 'Other')
	const categories = getAllExpenseCategories()
	entryExpenseCategoryInput.innerHTML = categories
		.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`)
		.join('')
	if (categories.includes(selected)) entryExpenseCategoryInput.value = selected
	else entryExpenseCategoryInput.value = 'Other'
}

function renderIncomeSourceOptions() {
	if (!entryIncomeSourceInput) return
	const selected = sanitizeShortText(entryIncomeSourceInput.value || '', 60)
	const categories = getAllIncomeCategories()
	entryIncomeSourceInput.innerHTML = categories
		.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`)
		.join('')
	if (categories.includes(selected)) entryIncomeSourceInput.value = selected
	else entryIncomeSourceInput.value = categories[0] || 'Other'
}

function renderCategoryManager() {
	renderExpenseCategoryOptions()
	renderIncomeSourceOptions()

	if (expenseCategoryDisplay) {
		expenseCategoryDisplay.innerHTML = getAllExpenseCategories()
			.map((category) => `<button type="button" class="habit-card-chip details-category-chip" data-select-expense-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`)
			.join('') || '<div class="breakdown-empty">No expense categories yet.</div>'
	}

	if (incomeCategoryDisplay) {
		const incomeCategories = getAllIncomeCategories()
		incomeCategoryDisplay.innerHTML = incomeCategories.length
			? incomeCategories.map((category) => `<button type="button" class="habit-card-chip details-category-chip" data-select-income-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`).join('')
			: '<div class="breakdown-empty">No income categories yet.</div>'
	}
}

function updateEntryEditUi() {
	const isEditing = Boolean(editingLedgerClientId)
	if (entryAddBtn) entryAddBtn.textContent = isEditing ? 'Update Financial Entry' : 'Save Financial Entry'
	if (entryCancelEditBtn) entryCancelEditBtn.hidden = !isEditing
	if (entryEditState) {
		entryEditState.textContent = isEditing
			? 'Editing an existing financial entry. Save to update it, or cancel to create a new one.'
			: 'Creating a new financial entry.'
	}
}

function resetFinancialEntryEditor() {
	editingLedgerClientId = ''
	incomeAllocationDraft = {}
	expenseAllocationDraft = {}
	if (entryIncomeInput) entryIncomeInput.value = '0'
	if (entryIncomeSourceInput) entryIncomeSourceInput.value = getAllIncomeCategories()[0] || 'Other'
	if (entryIncomeNoteInput) entryIncomeNoteInput.value = ''
	if (entryExpensesInput) entryExpensesInput.value = '0'
	if (entryExpenseCategoryInput) entryExpenseCategoryInput.value = 'Housing'
	if (entryExpenseNoteInput) entryExpenseNoteInput.value = ''
	if (entrySavingsInput) entrySavingsInput.value = '0'
	syncFinancialProgressUi()
	renderEntryAllocationDrafts()
	updateEntryEditUi()
}

function ensureEntryEditCategoriesAvailable(meta) {
	const nextIncomeCategories = [...customIncomeCategories]
	const nextExpenseCategories = [...customExpenseCategories]

	const incomeCandidates = [
		sanitizeShortText(meta?.incomeSource || '', 60),
		...Object.keys(meta?.incomeAllocations || {}).map((name) => sanitizeShortText(name, 60)),
	].filter(Boolean)
	for (const candidate of incomeCandidates) {
		if (!getAllIncomeCategories().some((item) => item.toLowerCase() === candidate.toLowerCase())) {
			nextIncomeCategories.push(candidate)
		}
	}

	const expenseCandidates = [
		sanitizeShortText(meta?.expenseCategory || '', 60),
		...Object.keys(meta?.expenseAllocations || {}).map((name) => sanitizeShortText(name, 60)),
	].filter(Boolean)
	for (const candidate of expenseCandidates) {
		if (!getAllExpenseCategories().some((item) => item.toLowerCase() === candidate.toLowerCase())) {
			nextExpenseCategories.push(candidate)
		}
	}

	if (nextIncomeCategories.length !== customIncomeCategories.length) {
		saveIncomeCategoriesToStorage(nextIncomeCategories)
	}
	if (nextExpenseCategories.length !== customExpenseCategories.length) {
		saveExpenseCategoriesToStorage(nextExpenseCategories)
	}
}

function startFinancialEntryEdit(clientId) {
	const entry = ledgerEntries.find((item) => item.clientId === clientId)
	if (!entry) return
	const meta = getLedgerEntryMeta(entry.clientId)
	ensureEntryEditCategoriesAvailable(meta)
	renderCategoryManager()
	editingLedgerClientId = entry.clientId
	if (entryDateInput) entryDateInput.value = isoDateValue(entry.dayMs)
	if (entryIncomeInput) entryIncomeInput.value = String(Math.max(0, Math.round(Number(entry.incomeDollars) || 0)))
	if (entryExpensesInput) entryExpensesInput.value = String(Math.max(0, Math.round(Number(entry.expensesDollars) || 0)))
	if (entryIncomeSourceInput) entryIncomeSourceInput.value = meta.incomeSource || getAllIncomeCategories()[0] || 'Other'
	if (entryIncomeNoteInput) entryIncomeNoteInput.value = meta.incomeNote || ''
	if (entryExpenseCategoryInput) entryExpenseCategoryInput.value = meta.expenseCategory || 'Other'
	if (entryExpenseNoteInput) entryExpenseNoteInput.value = meta.expenseNote || ''
	incomeAllocationDraft = { ...(meta.incomeAllocations || {}) }
	expenseAllocationDraft = { ...(meta.expenseAllocations || {}) }
	syncFinancialProgressUi()
	renderEntryAllocationDrafts()
	updateEntryEditUi()
	setFinanceDetailFocus('income', { scroll: true })
}

function renderFinancialEntriesList() {
	if (!financialEntriesList) return
	if (!session) {
		financialEntriesList.innerHTML = '<div class="breakdown-empty">Log in to review saved entries.</div>'
		return
	}
	const filterDayMs = reviewEntryDateFilter ? parseDateInputToDayMs(reviewEntryDateFilter) : 0
	if (!filterDayMs) {
		financialEntriesList.innerHTML = '<div class="breakdown-empty">Pick a date to view saved entries.</div>'
		return
	}
	const items = ledgerEntries
		.slice()
		.filter((entry) => Number(entry?.dayMs) === filterDayMs)
		.sort((a, b) => Number(b?.dayMs) - Number(a?.dayMs))
		.slice(0, 20)
	if (!items.length) {
		financialEntriesList.innerHTML = '<div class="breakdown-empty">No entries for the selected date.</div>'
		return
	}
	financialEntriesList.innerHTML = items.map((entry) => {
		const meta = getLedgerEntryMeta(entry.clientId)
		const incomeAllocations = Object.entries(meta.incomeAllocations || {})
			.filter(([, dollars]) => Number(dollars) > 0)
			.sort((a, b) => Number(b[1]) - Number(a[1]))
		const expenseAllocations = Object.entries(meta.expenseAllocations || {})
			.filter(([, dollars]) => Number(dollars) > 0)
			.sort((a, b) => Number(b[1]) - Number(a[1]))
		const incomeAllocationRows = incomeAllocations.length
			? `<div class="entry-review-allocations">${incomeAllocations.map(([name, dollars]) => `<div class="entry-review-allocation-row"><span>${escapeHtml(name)}</span><strong>${formatDollars(dollars)}</strong></div>`).join('')}</div>`
			: ''
		const expenseAllocationRows = expenseAllocations.length
			? `<div class="entry-review-allocations">${expenseAllocations.map(([name, dollars]) => `<div class="entry-review-allocation-row"><span>${escapeHtml(name)}</span><strong>${formatDollars(dollars)}</strong></div>`).join('')}</div>`
			: ''
		return `<article class="entry-review-item">
			<div class="entry-review-head">
				<strong>${escapeHtml(formatDateLabel(entry.dayMs))}</strong>
				<div class="auth-actions"><button class="auth-btn auth-btn--secondary" type="button" data-edit-entry="${escapeHtml(entry.clientId)}">Edit</button></div>
			</div>
			<div class="entry-feed-line">Income: ${formatDollars(entry.incomeDollars)}</div>
			${incomeAllocationRows}
			<div class="entry-feed-line">Expenses: ${formatDollars(entry.expensesDollars)}</div>
			${expenseAllocationRows}
			<div class="entry-feed-line">Savings: ${formatDollars(entry.savingsDollars)}</div>
		</article>`
	}).join('')
}

function drawDetails() {
	if (!session) detailChartState = null
	const iso = isoDateValue(detailAnchorDayMs)
	if (entryDateInput && document.activeElement !== entryDateInput) entryDateInput.value = iso
	if (savedEntryDatePicker && document.activeElement !== savedEntryDatePicker) savedEntryDatePicker.value = reviewEntryDateFilter || ''
	if (detailKindSelect) detailKindSelect.value = detailKind
	if (detailDateInput) detailDateInput.value = iso
	if (detailChartCanvas && detailRange && detailTooltip) {
		drawDetailChart(detailKind, detailChartCanvas, detailTooltip, detailRange)
		updateDetailsTotals()
	}
	syncFinancialProgressUi()
	renderCategoryManager()
	renderFinancialEntriesList()
	updateEntryEditUi()
	setFinanceDetailFocus(financeDetailFocus, { scroll: false })
}

function closeFinancialBreakdownModal() {
	if (!financialBreakdownModal) return
	if (financialBreakdownModal.open && typeof financialBreakdownModal.close === 'function') {
		financialBreakdownModal.close()
	} else {
		financialBreakdownModal.removeAttribute('open')
	}
}

function openFinancialBreakdownModal(focus = 'income') {
	const normalizedFocus = focus === 'expenses' ? 'expenses' : 'income'
	setFinanceDetailFocus(normalizedFocus, { scroll: false })
	if (financialBreakdownModalTitle) {
		financialBreakdownModalTitle.textContent = normalizedFocus === 'expenses' ? 'Expense Breakdown' : 'Income Breakdown'
	}
	if (!financialBreakdownModal) return
	if (typeof financialBreakdownModal.showModal === 'function') {
		if (!financialBreakdownModal.open) financialBreakdownModal.showModal()
		return
	}
	financialBreakdownModal.setAttribute('open', '')
}

function setFinanceDetailFocus(focus, { scroll = true } = {}) {
	financeDetailFocus = focus === 'expenses' || focus === 'progress' || focus === 'categories' ? focus : 'income'
	const sectionMap = {
		income: incomeBreakdownPanel,
		expenses: expenseBreakdownPanel,
	}
	for (const [name, section] of Object.entries(sectionMap)) {
		if (!section) continue
		section.hidden = name !== financeDetailFocus
	}
	const target = sectionMap[financeDetailFocus]
	if (scroll && target && financialBreakdownModal?.open) {
		try {
			target.scrollIntoView({ behavior: 'smooth', block: 'start' })
		} catch {
			target.scrollIntoView(true)
		}
	}
}

function syncHomeQuickAmountUi() {
	if (!homeQuickAmountRange || !homeQuickAmountValue) return
	const dollars = Math.max(0, Math.round(Number(homeQuickAmountRange.value) || 0))
	homeQuickAmountValue.textContent = formatDollars(dollars)
}

function setEntrySavingsDraftAmount(value) {
	const dollars = Math.max(0, Math.round(Number(value) || 0))
	if (entrySavingsInput) entrySavingsInput.value = String(dollars)
	renderSavingsCategoryAllocation()
}

function updateProgress() {
	const goalUnits = Number(range.value)
	const goalDollars = goalUnits * DOLLARS_PER_UNIT
	const currentDollars = getCurrentSavingsForGoalProgress()
	updateDashboardSummary({ goalDollars, currentDollars })
	if (normalizeRoute(location.hash) === 'details') drawDetails()
}

function onInput() {
	const value = Number(range.value)
	valueOut.textContent = formatDollarsFromUnits(value)
	const percent = (value - MIN) / (MAX - MIN)
	range.style.setProperty('--range-pct', `${percent * 100}%`)
	layoutRocket()
	updateProgress()

	if (!suppressGoalPersist) {
		const goalDollars = value * DOLLARS_PER_UNIT
		if (goalTimer) window.clearTimeout(goalTimer)
		goalTimer = window.setTimeout(() => {
			void persistGoalDollars(goalDollars)
		}, 400)
	}
}

range.addEventListener('input', onInput)
range.addEventListener('change', () => {
	if (!suppressGoalPersist) setGoalSliderLocked(true)
})
goalEditBtn?.addEventListener('click', () => {
	setGoalSliderLocked(false)
	range.focus()
})

authForm?.addEventListener('submit', async (e) => {
	e.preventDefault()
	showAuthError('')
	try {
		loginBtn.disabled = true
		registerBtn.disabled = true
		const isRegister = authMode === 'register'
		const name = normalizePersonName(String(authName?.value || ''))
		const email = String(authEmail.value || '').trim().toLowerCase()
		const password = String(authPassword.value || '')

		if (isRegister) {
			if (password.length < 8) {
				throw new Error('Password must be at least 8 characters.')
			}
			if (isDesktopApp) {
				session = await desktop.auth.register(email, password, name)
			} else {
				const out = await cloudRegister(email, password, name)
				const token = typeof out?.token === 'string' ? out.token : ''
				const cloudUserId = typeof out?.userId === 'string' ? out.userId : ''
				const returnedName = typeof out?.name === 'string' ? out.name.trim() : ''
				const role = normalizeAccountRole(out?.role)
				if (!token) throw new Error('Registration failed')
				session = { id: 0, name: returnedName || name || undefined, email, token, cloudUserId: cloudUserId || undefined, role }
				saveWebSessionToStorage(session)
			}
		} else if (isDesktopApp) {
			session = await desktop.auth.login(email, password)
		} else {
			const out = await cloudLogin(email, password)
			const token = typeof out?.token === 'string' ? out.token : ''
			const cloudUserId = typeof out?.userId === 'string' ? out.userId : ''
			const returnedName = typeof out?.name === 'string' ? out.name.trim() : ''
			const role = normalizeAccountRole(out?.role)
			const assignedInstructorEmail = normalizeAccountEmail(out?.assignedInstructorEmail)
			if (!token) throw new Error('Login failed')
			session = { id: 0, name: returnedName || undefined, email, token, cloudUserId: cloudUserId || undefined, role, assignedInstructorEmail: assignedInstructorEmail || undefined }
			saveWebSessionToStorage(session)
		}

		// Clear previous values immediately (prevents old account values lingering).
		resetGoalUi({ persistLocal: !isDesktopApp })
		didWarnDesktopGoalSync = false

		authName.value = ''
		authPassword.value = ''
		setAuthMode('login')
		await loadUserScopedAppState()
		updateAuthUi()
		if (isDesktopApp) {
			await loadGoalFromDbOrMigrate()
			await loadSavingsLogEntriesFromDesktop()
			await loadLedgerEntriesFromStorage()
			void syncLedgerWithCloud()
		} else {
			await hydrateAccountFromCloud()
			await hydrateRendererStateFromCloud()
			await loadGoalFromCloudOrFallback()
			await hydrateProfileSettingsFromCloud()
			await loadLedgerEntriesFromStorage()
			void syncLedgerWithCloud()
		}
		updateAuthUi()
		updateProgress()
		renderRoute()
	} catch (err) {
		showAuthError(err?.message ? String(err.message) : (authMode === 'register' ? 'Registration failed' : 'Login failed'))
	} finally {
		loginBtn.disabled = false
		registerBtn.disabled = false
	}
})

registerBtn?.addEventListener('click', async () => {
	setAuthMode(authMode === 'register' ? 'login' : 'register')
})

authModeLoginBtn?.addEventListener('click', () => setAuthMode('login'))
authModeRegisterBtn?.addEventListener('click', () => setAuthMode('register'))

async function performLogout() {
	showAuthError('')
	try {
		if (topbarLogoutBtn) topbarLogoutBtn.disabled = true
		if (isDesktopApp) {
			await desktop.auth.logout()
			session = null
			ledgerEntries = []
			resetGoalUi({ persistLocal: false })
			didWarnDesktopGoalSync = false
		} else {
			session = null
			ledgerEntries = []
			saveWebSessionToStorage(null)
			resetGoalUi({ persistLocal: true })
		}
		await loadUserScopedAppState()
		try {
			saveLedgerCloudSyncState({ pendingClientIds: [], lastPullMs: 0 })
		} catch {
			// ignore
		}
		updateAuthUi()
		updateProgress()
	} catch {
		// ignore
	} finally {
		if (topbarLogoutBtn) topbarLogoutBtn.disabled = false
	}
}

topbarLogoutBtn?.addEventListener('click', performLogout)

setAuthMode('login')

window.addEventListener('resize', () => {
	layoutRocket()
	if (normalizeRoute(location.hash) === 'details') drawDetails()
})

detailChartCanvas?.addEventListener('pointermove', (e) => onDetailPointerMove(detailChartCanvas, detailTooltip, e))
detailChartCanvas?.addEventListener('pointerleave', () => hideDetailTooltip(detailTooltip))

detailKindSelect?.addEventListener('change', () => {
	const next = String(detailKindSelect.value || '').trim().toLowerCase()
	if (next === 'month' || next === 'year' || next === 'week') {
		detailKind = next
	}
	drawDetails()
})

detailDateInput?.addEventListener('change', () => {
	detailAnchorDayMs = parseDateInputToDayMs(detailDateInput.value)
	drawDetails()
})

detailPrevBtn?.addEventListener('click', () => {
	detailAnchorDayMs = shiftAnchor(detailKind, detailAnchorDayMs, -1)
	drawDetails()
})

detailNextBtn?.addEventListener('click', () => {
	detailAnchorDayMs = shiftAnchor(detailKind, detailAnchorDayMs, 1)
	drawDetails()
})

entryIncomeInput?.addEventListener('input', syncFinancialProgressUi)
entryExpensesInput?.addEventListener('input', syncFinancialProgressUi)

savingsCategoryListWrap?.addEventListener('input', (event) => {
	const target = /** @type {HTMLInputElement} */ (event.target)
	const sliderIndex = Number(target?.dataset?.categoryIndex)
	const amountIndex = Number(target?.dataset?.categoryAmountIndex)
	const categories = getAllSavingsCategories()
	if (Number.isFinite(sliderIndex) && categories[sliderIndex]) {
		entrySavingsAllocationDraft[categories[sliderIndex]] = Math.max(0, Math.round(Number(target.value) || 0))
		renderSavingsCategoryAllocation()
		return
	}
	if (Number.isFinite(amountIndex) && categories[amountIndex]) {
		entrySavingsAllocationDraft[categories[amountIndex]] = Math.max(0, Math.round(Number(target.value) || 0))
		renderSavingsCategoryAllocation()
	}
})

savingsCategoryListWrap?.addEventListener('click', (event) => {
	const target = /** @type {HTMLElement} */ (event.target)
	const button = /** @type {HTMLButtonElement | null} */ (target?.closest?.('[data-remove-category-index]'))
	if (!button) return
	const categoryIndex = Number(button.dataset.removeCategoryIndex)
	if (!Number.isFinite(categoryIndex)) return
	const category = getAllSavingsCategories()[categoryIndex]
	if (!category || DEFAULT_FUND_NAMES.includes(category)) return
	const nextCategories = customSavingsCategories.filter((name) => name !== category)
	saveSavingsCategoriesToStorage(nextCategories)
	delete entrySavingsAllocationDraft[category]
	renderSavingsCategoryAllocation()
	showEntryError('')
})

entryAddCategoryBtn?.addEventListener('click', () => {
	const safeName = normalizeFundName(entryCategoryNameInput?.value)
	if (!safeName) {
		showEntryError('Enter a category name before adding it.')
		return
	}
	if (getAllSavingsCategories().includes(safeName)) {
		showEntryError('That category already exists.')
		return
	}
	saveSavingsCategoriesToStorage([...customSavingsCategories, safeName])
	entrySavingsAllocationDraft[safeName] = 0
	if (entryCategoryNameInput) entryCategoryNameInput.value = ''
	showEntryError('')
	renderSavingsCategoryAllocation()
})

dashboardContent?.addEventListener('click', (event) => {
	const target = /** @type {HTMLElement} */ (event.target)
	const focusButton = /** @type {HTMLButtonElement | null} */ (target?.closest?.('[data-finance-focus]'))
	if (focusButton) {
		const focus = String(focusButton.dataset.financeFocus || 'income')
		setFinanceDetailFocus(focus, { scroll: false })
		location.hash = '#details'
		requestAnimationFrame(() => setFinanceDetailFocus(focus, { scroll: true }))
		return
	}
	const quickButton = /** @type {HTMLButtonElement | null} */ (target?.closest?.('#homeStartAllocationBtn'))
	if (quickButton) {
		const dollars = Math.max(0, Math.round(Number(homeQuickAmountRange?.value) || 0))
		setEntrySavingsDraftAmount(dollars)
		setFinanceDetailFocus('progress', { scroll: false })
		location.hash = '#details'
		requestAnimationFrame(() => setFinanceDetailFocus('progress', { scroll: true }))
	}
})

entryForm?.addEventListener('click', (event) => {
	const target = /** @type {HTMLElement} */ (event.target)
	const toggle = /** @type {HTMLButtonElement | null} */ (target?.closest?.('[data-breakdown-target]'))
	if (toggle) {
		const focus = String(toggle.dataset.breakdownTarget || 'income')
		openFinancialBreakdownModal(focus)
		return
	}
	const expenseChip = /** @type {HTMLButtonElement | null} */ (target?.closest?.('[data-select-expense-category]'))
	if (expenseChip) {
		const category = String(expenseChip.dataset.selectExpenseCategory || '')
		if (entryExpenseCategoryInput && category) entryExpenseCategoryInput.value = category
		setFinanceDetailFocus('expenses', { scroll: true })
		return
	}
	const incomeChip = /** @type {HTMLButtonElement | null} */ (target?.closest?.('[data-select-income-category]'))
	if (incomeChip) {
		const category = String(incomeChip.dataset.selectIncomeCategory || '')
		if (entryIncomeSourceInput && category) entryIncomeSourceInput.value = category
		setFinanceDetailFocus('income', { scroll: true })
		return
	}
})

financialEntriesList?.addEventListener('click', (event) => {
	const target = /** @type {HTMLElement} */ (event.target)
	const editBtn = /** @type {HTMLButtonElement | null} */ (target?.closest?.('[data-edit-entry]'))
	if (!editBtn) return
	const clientId = String(editBtn.dataset.editEntry || '').trim()
	if (clientId) startFinancialEntryEdit(clientId)
})

openCategoriesBtn?.addEventListener('click', () => {
	renderCategoryManager()
	setFinanceDetailFocus('categories', { scroll: true })
})

closeCategoriesBtn?.addEventListener('click', () => {
	setFinanceDetailFocus('income', { scroll: true })
})

closeBreakdownModalBtn?.addEventListener('click', () => {
	closeFinancialBreakdownModal()
})

financialBreakdownModal?.addEventListener('click', (event) => {
	if (event.target === financialBreakdownModal) closeFinancialBreakdownModal()
})

entryCancelEditBtn?.addEventListener('click', () => {
	resetFinancialEntryEditor()
	showEntryError('')
})

addExpenseCategoryBtn?.addEventListener('click', () => {
	const category = sanitizeShortText(newExpenseCategoryInput?.value || '', 60)
	if (!category) {
		showEntryError('Enter an expense category name first.')
		return
	}
	const exists = getAllExpenseCategories().some((item) => item.toLowerCase() === category.toLowerCase())
	if (exists) {
		showEntryError('Expense category already exists.')
		return
	}
	saveExpenseCategoriesToStorage([...customExpenseCategories, category])
	if (newExpenseCategoryInput) newExpenseCategoryInput.value = ''
	renderCategoryManager()
	if (entryExpenseCategoryInput) entryExpenseCategoryInput.value = category
	showEntryError('')
})

addIncomeCategoryBtn?.addEventListener('click', () => {
	const category = sanitizeShortText(newIncomeCategoryInput?.value || '', 60)
	if (!category) {
		showEntryError('Enter an income category name first.')
		return
	}
	const exists = getAllIncomeCategories().some((item) => item.toLowerCase() === category.toLowerCase())
	if (exists) {
		showEntryError('Income category already exists.')
		return
	}
	saveIncomeCategoriesToStorage([...getAllIncomeCategories(), category])
	if (newIncomeCategoryInput) newIncomeCategoryInput.value = ''
	renderCategoryManager()
	if (entryIncomeSourceInput) entryIncomeSourceInput.value = category
	showEntryError('')
})

renameIncomeCategoryBtn?.addEventListener('click', async () => {
	const previous = sanitizeShortText(entryIncomeSourceInput?.value || '', 60)
	const next = sanitizeShortText(newIncomeCategoryInput?.value || '', 60)
	const normalizeIncomeName = (value) => sanitizeShortText(value || '', 60).toLowerCase().replace(/[^a-z0-9]/g, '')
	if (!previous) {
		showEntryError('Select an income category to rename.')
		return
	}
	if (!next) {
		showEntryError('Enter the new income category name first.')
		return
	}
	if (normalizeIncomeName(previous) === normalizeIncomeName(next)) {
		showEntryError('Choose a different name to rename this category.')
		return
	}
	if (getAllIncomeCategories().some((item) => normalizeIncomeName(item) === normalizeIncomeName(next))) {
		showEntryError('An income category with that name already exists.')
		return
	}

	const previousKey = normalizeIncomeName(previous)
	const renamedCategories = getAllIncomeCategories().map((item) => (normalizeIncomeName(item) === previousKey ? next : item))
	saveIncomeCategoriesToStorage(renamedCategories)
	const now = Date.now()

	const candidateClientIds = new Set([
		...ledgerEntries.map((entry) => String(entry?.clientId || '').trim()).filter(Boolean),
		...Object.keys(ledgerEntryMetaByClientId || {}).map((id) => String(id || '').trim()).filter(Boolean),
	])

	for (const clientId of candidateClientIds) {
		if (!clientId) continue
		const meta = getLedgerEntryMeta(clientId)
		let changed = false
		const incomeAllocations = { ...(meta.incomeAllocations || {}) }
		if (normalizeIncomeName(meta.incomeSource || '') === previousKey) {
			meta.incomeSource = next
			changed = true
		}
		const matchingAllocationKeys = Object.keys(incomeAllocations).filter((name) => normalizeIncomeName(name) === previousKey)
		if (matchingAllocationKeys.length) {
			let movedTotal = 0
			for (const allocationKey of matchingAllocationKeys) {
				movedTotal += Math.max(0, Math.round(Number(incomeAllocations[allocationKey]) || 0))
				delete incomeAllocations[allocationKey]
			}
			incomeAllocations[next] = Math.max(0, Math.round(Number(incomeAllocations[next]) || 0)) + movedTotal
			changed = true
		}
		if (!changed) continue
		setLedgerEntryMeta(clientId, {
			...meta,
			incomeAllocations,
		})
		const entry = ledgerEntries.find((item) => item.clientId === clientId)
		if (entry) {
			await upsertLedgerEntryLocally({
				...entry,
				updatedAtMs: now,
			})
		}
		enqueueLedgerForCloudSync(clientId)
	}

	const draftKeys = Object.keys(incomeAllocationDraft).filter((name) => normalizeIncomeName(name) === previousKey)
	if (draftKeys.length) {
		let movedTotal = 0
		for (const draftKey of draftKeys) {
			movedTotal += Math.max(0, Math.round(Number(incomeAllocationDraft[draftKey]) || 0))
			delete incomeAllocationDraft[draftKey]
		}
		incomeAllocationDraft[next] = Math.max(0, Math.round(Number(incomeAllocationDraft[next]) || 0)) + movedTotal
		renderEntryAllocationDrafts()
	}

	if (newIncomeCategoryInput) newIncomeCategoryInput.value = ''
	renderCategoryManager()
	renderFinancialEntriesList()
	if (entryIncomeSourceInput) entryIncomeSourceInput.value = next
	void syncLedgerWithCloud()
	showEntryError('')
})

addIncomeAllocationBtn?.addEventListener('click', () => {
	const key = sanitizeShortText(entryIncomeSourceInput?.value || '', 60)
	const amount = Math.max(0, Math.round(Number(incomeAllocationAmountInput?.value) || 0))
	if (!key) {
		showEntryError('Select or type an income source before adding allocation.')
		return
	}
	if (amount <= 0) {
		showEntryError('Enter an income allocation amount greater than 0.')
		return
	}
	const income = getFinancialDraftValues().income
	const current = sumAllocationDraft(incomeAllocationDraft)
	if (current + amount > income) {
		showEntryError('Income allocation exceeds income slider total.')
		return
	}
	incomeAllocationDraft[key] = Math.max(0, Math.round(Number(incomeAllocationDraft[key]) || 0)) + amount
	if (incomeAllocationAmountInput) incomeAllocationAmountInput.value = '0'
	renderEntryAllocationDrafts()
	showEntryError('')
})

addExpenseAllocationBtn?.addEventListener('click', () => {
	const key = sanitizeShortText(entryExpenseCategoryInput?.value || '', 60)
	const amount = Math.max(0, Math.round(Number(expenseAllocationAmountInput?.value) || 0))
	if (!key) {
		showEntryError('Select an expense category before adding allocation.')
		return
	}
	if (amount <= 0) {
		showEntryError('Enter an expense allocation amount greater than 0.')
		return
	}
	const expenses = getFinancialDraftValues().expenses
	const current = sumAllocationDraft(expenseAllocationDraft)
	if (current + amount > expenses) {
		showEntryError('Expense allocation exceeds expense slider total.')
		return
	}
	expenseAllocationDraft[key] = Math.max(0, Math.round(Number(expenseAllocationDraft[key]) || 0)) + amount
	if (expenseAllocationAmountInput) expenseAllocationAmountInput.value = '0'
	renderEntryAllocationDrafts()
	showEntryError('')
})

incomeAllocationAmountInput?.addEventListener('keydown', (event) => {
	if (event.key !== 'Enter') return
	event.preventDefault()
	addIncomeAllocationBtn?.click()
})

expenseAllocationAmountInput?.addEventListener('keydown', (event) => {
	if (event.key !== 'Enter') return
	event.preventDefault()
	addExpenseAllocationBtn?.click()
})

incomeAllocationList?.addEventListener('click', (event) => {
	const target = /** @type {HTMLElement} */ (event.target)
	const remove = /** @type {HTMLButtonElement | null} */ (target?.closest?.('[data-remove-income-allocation]'))
	if (!remove) return
	const key = String(remove.dataset.removeIncomeAllocation || '')
	if (key) delete incomeAllocationDraft[key]
	renderEntryAllocationDrafts()
})

expenseAllocationList?.addEventListener('click', (event) => {
	const target = /** @type {HTMLElement} */ (event.target)
	const remove = /** @type {HTMLButtonElement | null} */ (target?.closest?.('[data-remove-expense-allocation]'))
	if (!remove) return
	const key = String(remove.dataset.removeExpenseAllocation || '')
	if (key) delete expenseAllocationDraft[key]
	renderEntryAllocationDrafts()
})

savedEntryDatePicker?.addEventListener('change', () => {
	reviewEntryDateFilter = String(savedEntryDatePicker.value || '').trim()
	renderFinancialEntriesList()
	showEntryError('')
})

homeQuickAmountRange?.addEventListener('input', syncHomeQuickAmountUi)

function showEntryError(msg) {
	if (!entryError) return
	const text = String(msg || '').trim()
	entryError.textContent = text
	entryError.hidden = !text
}

function isFinancialBreakdownModalOpen() {
	return Boolean(financialBreakdownModal && (financialBreakdownModal.open || financialBreakdownModal.hasAttribute('open')))
}

function triggerBreakdownAllocationFromContext(sourceNode) {
	if (!isFinancialBreakdownModalOpen()) return false
	const target = sourceNode instanceof HTMLElement ? sourceNode : document.activeElement
	if (!(target instanceof HTMLElement)) return false
	if (target.closest('#incomeBreakdownPanel')) {
		addIncomeAllocationBtn?.click()
		return true
	}
	if (target.closest('#expenseBreakdownPanel')) {
		addExpenseAllocationBtn?.click()
		return true
	}
	return false
}

financialBreakdownModal?.addEventListener('keydown', (event) => {
	if (event.key !== 'Enter') return
	const target = event.target instanceof HTMLElement ? event.target : null
	if (target?.closest('button')) return
	if (triggerBreakdownAllocationFromContext(target)) {
		event.preventDefault()
		event.stopPropagation()
	}
})

entryForm?.addEventListener('keydown', (event) => {
	if (event.key !== 'Enter') return
	if (isFinancialBreakdownModalOpen()) return
	const target = event.target instanceof HTMLElement ? event.target : null
	if (!target) return
	if (target.closest('button')) return
	if (target.closest('dialog')) return
	event.preventDefault()
	entryAddBtn?.click()
})

entryForm?.addEventListener('submit', async (e) => {
	e.preventDefault()
	showEntryError('')
	if (isFinancialBreakdownModalOpen()) {
		const submitter = e.submitter instanceof HTMLElement ? e.submitter : null
		if (!triggerBreakdownAllocationFromContext(submitter)) {
			showEntryError('Close the breakdown popup before saving your entry.')
		}
		return
	}
	if (!session) {
		showEntryError('Log in to add entries')
		return
	}
	try {
		if (entryAddBtn) entryAddBtn.disabled = true
		const dayMs = parseDateInputToDayMs(entryDateInput?.value)
		const income = parseMoneyInput(entryIncomeInput?.value)
		const expenses = parseMoneyInput(entryExpensesInput?.value)
		const savings = Math.max(0, income - expenses)
		if (entrySavingsInput) entrySavingsInput.value = String(savings)
		const funds = buildEntryFundsFromDraft(savings)
		if (!Object.keys(funds).length && savings > 0) funds['E-Fund'] = savings
		const existingEntry = editingLedgerClientId
			? ledgerEntries.find((item) => item.clientId === editingLedgerClientId)
			: null
		const entry = existingEntry
			? {
				...existingEntry,
				dayMs,
				incomeDollars: income,
				expensesDollars: expenses,
				savingsDollars: savings,
				updatedAtMs: Date.now(),
			}
			: await addLedgerEntry({ dayMs, incomeDollars: income, expensesDollars: expenses, savingsDollars: savings })

		if (existingEntry) {
			await upsertLedgerEntryLocally(entry)
			enqueueLedgerForCloudSync(entry.clientId)
			void syncLedgerWithCloud()
			await syncCurrentSavingsSnapshotFromLedger()
		}
		const savedIncomeSource = sanitizeShortText(entryIncomeSourceInput?.value || '', 60)
		const savedExpenseCategory = sanitizeShortText(entryExpenseCategoryInput?.value || 'Other', 60)
		setLedgerEntryMeta(entry?.clientId, {
			incomeSource: sanitizeShortText(savedIncomeSource, 120),
			incomeNote: sanitizeLongText(entryIncomeNoteInput?.value || '', 240),
			expenseCategory: String(savedExpenseCategory || 'Other'),
			expenseNote: sanitizeLongText(entryExpenseNoteInput?.value || '', 240),
			incomeAllocations: incomeAllocationDraft,
			expenseAllocations: expenseAllocationDraft,
			funds,
		})
		enqueueLedgerForCloudSync(entry?.clientId)
		void syncLedgerWithCloud()
		if (savedIncomeSource && !getAllIncomeCategories().some((item) => item.toLowerCase() === savedIncomeSource.toLowerCase())) {
			saveIncomeCategoriesToStorage([...customIncomeCategories, savedIncomeSource])
		}
		if (savedExpenseCategory && !getAllExpenseCategories().some((item) => item.toLowerCase() === savedExpenseCategory.toLowerCase())) {
			saveExpenseCategoriesToStorage([...customExpenseCategories, savedExpenseCategory])
		}
		if (entryIncomeInput) entryIncomeInput.value = '0'
		if (entryIncomeSourceInput) entryIncomeSourceInput.value = getAllIncomeCategories()[0] || 'Other'
		if (entryIncomeNoteInput) entryIncomeNoteInput.value = ''
		if (entryExpensesInput) entryExpensesInput.value = '0'
		if (entryExpenseCategoryInput) entryExpenseCategoryInput.value = 'Housing'
		if (entryExpenseNoteInput) entryExpenseNoteInput.value = ''
		if (entrySavingsInput) entrySavingsInput.value = '0'
		editingLedgerClientId = ''
		incomeAllocationDraft = {}
		expenseAllocationDraft = {}
		entrySavingsAllocationDraft = {}
		syncFinancialProgressUi()
		renderCategoryManager()
		renderFinancialEntriesList()
		updateEntryEditUi()
		updateProgress()
		drawDetails()
	} catch (err) {
		showEntryError(err?.message ? String(err.message) : 'Failed to add entry')
	} finally {
		if (entryAddBtn) entryAddBtn.disabled = false
	}
})

// Initial layout after first paint (ensures we can measure sizes).
requestAnimationFrame(() => {
	onInput()
	syncHomeQuickAmountUi()
	if (detailDateInput) detailDateInput.value = isoDateValue(detailAnchorDayMs)
	if (entryDateInput) entryDateInput.value = isoDateValue(detailAnchorDayMs)
	renderSavingsCategoryAllocation()
	setFinanceDetailFocus(financeDetailFocus, { scroll: false })
})
