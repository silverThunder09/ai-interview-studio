import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { InterviewHistory, InterviewQuestion, InterviewSession, InterviewSummary, StartInterviewRequest, SubmitAnswerRequest } from '../shared/interview';
import { INTERVIEW_LIMITS, isInterviewId, isInterviewQuestion, isStartInterviewRequest } from '../shared/interview';
import { LocalQuestionProvider, type QuestionDraft, type QuestionProvider } from './questions';

export class InterviewStoreError extends Error {}
interface SessionRow { id: string; created_at: string; status: InterviewSession['status']; reviewed_text: string; sources: string; request_hash: string }
interface TurnRow { sequence: number; question_id: string; question: string; answer: string | null }

export class InterviewStore {
  private readonly database: DatabaseSync;
  constructor(readonly path: string, private readonly provider: QuestionProvider = new LocalQuestionProvider()) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.database = new DatabaseSync(path, { enableForeignKeyConstraints: true, enableDoubleQuotedStringLiterals: false, allowExtension: false });
    try {
      const version = Number(this.database.prepare('PRAGMA user_version').get()?.user_version);
      if (version > 1) throw new InterviewStoreError('이 앱보다 새 버전의 기록 저장소입니다. 최신 앱으로 열어 주세요.');
      this.database.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON; PRAGMA busy_timeout=1000;');
      if (version === 0) this.transaction(() => {
        this.database.exec(`
          CREATE TABLE sessions (
            id TEXT PRIMARY KEY, request_id TEXT UNIQUE NOT NULL, request_hash TEXT NOT NULL,
            created_at TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('active','completed')),
            reviewed_text TEXT NOT NULL, sources TEXT NOT NULL
          ) STRICT;
          CREATE TABLE turns (
            session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            sequence INTEGER NOT NULL, question_id TEXT UNIQUE NOT NULL,
            question TEXT NOT NULL, answer TEXT,
            PRIMARY KEY (session_id, sequence)
          ) STRICT;
          PRAGMA user_version=1;
        `);
      });
      if (process.platform !== 'win32') chmodSync(path, 0o600);
    } catch (error) { this.database.close(); throw error; }
  }
  private transaction<T>(action: () => T): T {
    this.database.exec('BEGIN IMMEDIATE');
    try { const result = action(); this.database.exec('COMMIT'); return result; }
    catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }
  private row(id: string): SessionRow {
    const row = this.database.prepare('SELECT * FROM sessions WHERE id=?').get(id) as unknown as SessionRow | undefined;
    if (!row) throw new InterviewStoreError('기록이 없습니다. 삭제되었는지 확인해 주세요.');
    return row;
  }
  get(id: string): InterviewSession {
    const row = this.row(id);
    const damaged = () => new InterviewStoreError('저장된 기록의 형식이 손상되어 열 수 없습니다. 원본 파일은 자동 초기화하지 않습니다.');
    if (typeof row.sources !== 'string' || row.sources.length > 1_000_000 || !Number.isFinite(Date.parse(row.created_at)) || !['active', 'completed'].includes(row.status)) throw damaged();
    const sourceSections: unknown = JSON.parse(row.sources);
    const resume = { requestId: row.id, reviewedText: row.reviewed_text, sourceSections, storageConsent: true };
    if (!isStartInterviewRequest(resume)) throw damaged();
    const rows = this.database.prepare('SELECT sequence,question_id,question,answer FROM turns WHERE session_id=? ORDER BY sequence').all(id) as unknown as TurnRow[];
    if (!rows.length || rows.length > INTERVIEW_LIMITS.turns) throw damaged();
    const turns = rows.map((turn, index) => {
      if (typeof turn.question !== 'string' || turn.question.length > 10_000) throw damaged();
      const question: unknown = JSON.parse(turn.question);
      if (!isInterviewQuestion(question) || question.id !== turn.question_id || turn.sequence !== index || question.number !== index + 1 || !isInterviewId(turn.question_id)) throw damaged();
      const pending = row.status === 'active' && index === rows.length - 1;
      if (pending ? turn.answer !== null : typeof turn.answer !== 'string' || !turn.answer.trim() || turn.answer.includes('\0') || turn.answer.length > INTERVIEW_LIMITS.answerChars) throw damaged();
      return { question, answer: turn.answer };
    });
    return { id: row.id, createdAt: row.created_at, status: row.status, mode: 'local-practice', reviewedText: row.reviewed_text, sourceSections: resume.sourceSections, turns };
  }
  history(): InterviewHistory {
    const rows = this.database.prepare(`SELECT s.id,s.created_at,s.status,COUNT(t.answer) AS answered FROM sessions s
      LEFT JOIN turns t ON t.session_id=s.id GROUP BY s.id ORDER BY s.created_at DESC,s.id DESC LIMIT ?`).all(INTERVIEW_LIMITS.sessions);
    const sessions: InterviewSummary[] = rows.map((row) => ({ id: String(row.id), createdAt: String(row.created_at), status: row.status as InterviewSummary['status'], answered: Number(row.answered) }));
    return { sessions, storagePath: this.path, limit: INTERVIEW_LIMITS.sessions };
  }
  private addQuestion(sessionId: string, draft: Omit<InterviewQuestion, 'id' | 'number'>, sequence: number) {
    const question: InterviewQuestion = { ...draft, id: randomUUID(), number: sequence + 1 };
    this.database.prepare('INSERT INTO turns(session_id,sequence,question_id,question,answer) VALUES(?,?,?,?,NULL)').run(sessionId, sequence, question.id, JSON.stringify(question));
  }
  findStart(request: StartInterviewRequest): InterviewSession | null {
    const hash = createHash('sha256').update(JSON.stringify({ text: request.reviewedText, sources: request.sourceSections })).digest('hex');
    const existing = this.database.prepare('SELECT id,request_hash FROM sessions WHERE request_id=?').get(request.requestId);
    if (existing) {
      if (existing.request_hash !== hash) throw new InterviewStoreError('다른 내용으로 같은 시작 요청을 다시 사용할 수 없습니다.');
      return this.get(String(existing.id));
    }
    const count = Number(this.database.prepare('SELECT COUNT(*) AS count FROM sessions').get()?.count);
    if (count >= INTERVIEW_LIMITS.sessions) throw new InterviewStoreError('기록은 100개까지 저장할 수 있습니다. 필요 없는 기록을 삭제한 뒤 시작해 주세요.');
    return null;
  }
  start(request: StartInterviewRequest, generated?: QuestionDraft): InterviewSession {
    return this.transaction(() => {
      const existing = this.findStart(request);
      if (existing) return existing;
      const hash = createHash('sha256').update(JSON.stringify({ text: request.reviewedText, sources: request.sourceSections })).digest('hex');
      const question = generated ?? this.provider.next(request, []);
      if (!question) throw new Error('Missing first question');
      const id = randomUUID();
      this.database.prepare('INSERT INTO sessions VALUES(?,?,?,?,?,?,?)').run(id, request.requestId, hash, new Date().toISOString(), 'active', request.reviewedText, JSON.stringify(request.sourceSections));
      this.addQuestion(id, question, 0);
      return this.get(id);
    });
  }
  prepareAnswer(request: SubmitAnswerRequest): { session: InterviewSession; pending: boolean } {
    const session = this.get(request.sessionId);
    const turn = session.turns.find((item) => item.question.id === request.questionId);
    if (!turn) throw new InterviewStoreError('현재 면접의 질문이 아닙니다. 기록을 다시 열어 주세요.');
    if (turn.answer !== null) {
      if (turn.answer !== request.answer) throw new InterviewStoreError('이미 저장된 답변입니다. 기록을 다시 열어 주세요.');
      return { session, pending: false };
    }
    if (session.status !== 'active' || turn !== session.turns.at(-1)) throw new InterviewStoreError('현재 답변할 질문이 아닙니다.');
    return { session, pending: true };
  }
  answer(request: SubmitAnswerRequest, generated?: { next: QuestionDraft | null }): InterviewSession {
    return this.transaction(() => {
      const { session, pending } = this.prepareAnswer(request);
      if (!pending) return session;
      const turn = session.turns.at(-1)!;
      turn.answer = request.answer;
      const next = generated ? generated.next : this.provider.next(session, session.turns);
      if ((!next && session.turns.length !== INTERVIEW_LIMITS.turns) || (next && session.turns.length >= INTERVIEW_LIMITS.turns)) throw new Error('Invalid question transition');
      this.database.prepare('UPDATE turns SET answer=? WHERE session_id=? AND question_id=? AND answer IS NULL').run(request.answer, session.id, request.questionId);
      if (next) this.addQuestion(session.id, next, session.turns.length);
      else this.database.prepare("UPDATE sessions SET status='completed' WHERE id=?").run(session.id);
      return this.get(session.id);
    });
  }
  delete(id: string): void {
    this.transaction(() => { this.row(id); this.database.prepare('DELETE FROM sessions WHERE id=?').run(id); });
  }
  deleteAll(): void { this.transaction(() => { this.database.exec('DELETE FROM sessions'); }); }
  close(): void { this.database.close(); }
}
