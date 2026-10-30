import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  Activity,
  ArrowDownToLine,
  ArrowUpRight,
  BadgeCheck,
  CalendarDays,
  Check,
  Clock3,
  Copy,
  CreditCard,
  ExternalLink,
  FileText,
  LayoutDashboard,
  Link2,
  LogOut,
  Plus,
  Search,
  ShieldCheck,
  Users,
  Wallet,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { type Session, type SupabaseClient } from '@supabase/supabase-js';
import { Link, Navigate, NavLink, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import { currentDate, dateTime, money, shortDate } from './lib/format.js';

type ChargeStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'REFUNDED' | 'CHARGED_BACK' | 'EXPIRED' | 'CANCELED';
type Charge = {
  id: string;
  identifier: string;
  customer: string;
  email: string;
  method: 'PIX' | 'CARD' | 'BOLETO';
  amount: number;
  fee: number;
  status: ChargeStatus;
  pixCode: string | null;
  pixImage: string | null;
  pixExpiresAt: string | null;
  createdAt: string;
};
type Customer = { id: string; name: string; email: string; phone: string; createdAt: string };
type PaymentLink = { id: string; name: string; amount: number; status: 'ACTIVE' | 'PAID' | 'PAUSED'; createdAt: string };
type SavedDocument = { id: string; title: string; type: 'RECEIPT' | 'PAYMENT_CONFIRMATION'; createdAt: string; chargeId: string };
type LiveData = { charges: Charge[]; customers: Customer[]; links: PaymentLink[]; documents: SavedDocument[] };
type DialogKind = 'charge' | 'deposit' | 'link' | 'customer' | 'document';
type PixResponse = { chargeId: string; transactionId: string; status: ChargeStatus; fee: number; purpose?: 'charge' | 'deposit'; pix: { code: string; image?: string; expiresAt?: string } };
type ApiErrorResponse = { message?: string; details?: { path?: string; error?: { message?: string } }[] };

const emptyData: LiveData = { charges: [], customers: [], links: [], documents: [] };
const navItems: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/dashboard', label: 'Visao geral', icon: LayoutDashboard },
  { to: '/charges', label: 'Cobrancas', icon: CreditCard },
  { to: '/links', label: 'Links de pagamento', icon: Link2 },
  { to: '/customers', label: 'Clientes', icon: Users },
  { to: '/documents', label: 'Documentos', icon: FileText },
  { to: '/accounts', label: 'Saldos e repasses', icon: Wallet },
  { to: '/integrations', label: 'Integracoes', icon: Zap },
];

function getApiErrorMessage(body: ApiErrorResponse, fallback: string) {
  const details = body.details
    ?.map(({ path, error }) => [path, error?.message].filter(Boolean).join(': '))
    .filter(Boolean)
    .join('; ');
  return [body.message ?? fallback, details].filter(Boolean).join(' — ');
}

function fromChargeRow(row: Record<string, unknown>): Charge {
  return {
    id: String(row.id),
    identifier: String(row.identifier),
    customer: String(row.customer_name),
    email: String(row.customer_email),
    method: String(row.payment_method) as Charge['method'],
    amount: Number(row.amount_cents) / 100,
    fee: Number(row.fee_cents ?? 0) / 100,
    status: String(row.status) as ChargeStatus,
    pixCode: typeof row.pix_copy_paste === 'string' ? row.pix_copy_paste : null,
    pixImage: typeof row.pix_image_url === 'string' ? row.pix_image_url : null,
    pixExpiresAt: typeof row.pix_expires_at === 'string' ? row.pix_expires_at : null,
    createdAt: String(row.created_at),
  };
}

function fromCustomerRow(row: Record<string, unknown>): Customer {
  return { id: String(row.id), name: String(row.name), email: String(row.email), phone: String(row.phone ?? ''), createdAt: String(row.created_at) };
}

function fromLinkRow(row: Record<string, unknown>): PaymentLink {
  return { id: String(row.id), name: String(row.name), amount: Number(row.amount_cents) / 100, status: String(row.status) as PaymentLink['status'], createdAt: String(row.created_at) };
}

function fromDocumentRow(row: Record<string, unknown>): SavedDocument {
  return { id: String(row.id), title: String(row.title), type: String(row.type) as SavedDocument['type'], createdAt: String(row.created_at), chargeId: String(row.charge_id) };
}

function StatusBadge({ status }: { status: string }) {
  const positive = ['COMPLETED', 'ACTIVE'].includes(status);
  const negative = ['FAILED', 'REFUNDED', 'CHARGED_BACK', 'EXPIRED', 'CANCELED', 'PAUSED'].includes(status);
  const className = positive ? 'status-positive' : negative ? 'status-negative' : 'status-pending';
  const labels: Record<string, string> = {
    COMPLETED: 'Concluido', PENDING: 'Pendente', FAILED: 'Falhou', REFUNDED: 'Reembolsado',
    CHARGED_BACK: 'Contestado', EXPIRED: 'Expirado', CANCELED: 'Cancelado', ACTIVE: 'Ativo', PAUSED: 'Pausado', PAID: 'Pago',
  };
  return <span className={`status-badge ${className}`}><span className="status-dot" />{labels[status] ?? status}</span>;
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="page-description">{description}</p></div>{action}</div>;
}

function MetricCard({ label, value, note, icon: Icon, tone }: { label: string; value: string; note: string; icon: LucideIcon; tone: string }) {
  return <article className="metric-card"><div className={`metric-icon ${tone}`}><Icon size={18} strokeWidth={1.8} /></div><p className="metric-label">{label}</p><p className="metric-value">{value}</p><p className="metric-note">{note}</p></article>;
}

function EmptyState({ title, message, action }: { title: string; message: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-state-mark"><FileText size={20} /></div><h3>{title}</h3><p>{message}</p>{action}</div>;
}

function ConfigurationPage() {
  return <main className="connection-page"><section className="connection-panel"><img className="brand-mark brand-logo" src="/payflow-logo.jpg" alt="Logo" /><p className="eyebrow">CONFIGURACAO NECESSARIA</p><h1>Conecte seu Supabase</h1><p>O PayFlow nao mostra registros de exemplo. Para abrir o painel real, configure a URL do projeto e a chave publica no arquivo local da aplicacao web.</p><div className="config-code"><code>apps/web/.env</code><code>VITE_SUPABASE_URL=...</code><code>VITE_SUPABASE_ANON_KEY=...</code></div><p className="connection-note">No backend, configure tambem <code>SUPABASE_SERVICE_ROLE_KEY</code>, <code>POSEIDON_PUBLIC_KEY</code>, <code>POSEIDON_SECRET_KEY</code> e seu e-mail em <code>PAYFLOW_ALLOWED_EMAILS</code>. A service role e as chaves Poseidon nunca vao para o navegador.</p><a className="button button-secondary" href="https://supabase.com/dashboard" target="_blank" rel="noreferrer">Abrir Supabase <ExternalLink size={14} /></a></section></main>;
}

function AuthPage({ client }: { client: SupabaseClient }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const formData = new FormData(event.currentTarget);
    const email = String(formData.get('email')).trim().toLowerCase();
    const password = String(formData.get('password'));
    const fullName = String(formData.get('fullName') ?? '').trim();
    const phone = String(formData.get('phone') ?? '').trim();
    try {
      const result = mode === 'login'
        ? await client.auth.signInWithPassword({ email, password })
        : await client.auth.signUp({ email, password, options: { data: { full_name: fullName, phone } } });
      if (result.error) throw result.error;
      if (mode === 'signup' && !result.data.session) toast.success('Confira seu e-mail para confirmar a conta.');
      else toast.success('Sessao iniciada.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Nao foi possivel autenticar.');
    } finally {
      setBusy(false);
    }
  }

  return <main className="connection-page"><section className="auth-panel"><div className="auth-brand"><img className="brand-mark brand-logo" src="/payflow-logo.jpg" alt="Logo PayFlow" /><span>PAYFLOW<small>PAYMENTS PLATFORM</small></span></div><p className="eyebrow">ACESSO SEGURO</p><h1>{mode === 'login' ? 'Entre na sua conta.' : 'Crie seu acesso.'}</h1><p className="auth-description">Autenticacao gerenciada pelo Supabase. O painel nao possui senha padrao.</p><form className="form-stack" onSubmit={submit}>{mode === 'signup' && <><label>Nome completo<input name="fullName" autoComplete="name" required maxLength={120} placeholder="Seu nome completo" /></label><label>Telefone<input name="phone" type="tel" autoComplete="tel" required maxLength={30} placeholder="(11) 99999-9999" /></label></>}<label>E-mail<input name="email" type="email" autoComplete="email" required maxLength={160} placeholder="voce@empresa.com" /></label><label>Senha<input name="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={8} required /></label><button className="button button-primary auth-submit" disabled={busy}>{busy ? 'Aguarde...' : mode === 'login' ? 'Entrar' : 'Criar conta'} <ArrowUpRight size={15} /></button></form><button className="auth-toggle" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>{mode === 'login' ? 'Ainda nao tem acesso? Criar conta' : 'Ja possui acesso? Entrar'}</button><p className="connection-note">A criacao de cobrancas fica restrita aos e-mails autorizados na configuracao do servidor.</p></section></main>;
}

function DashboardPage({ data, openDialog }: { data: LiveData; openDialog: (kind: DialogKind) => void }) {
  const completed = data.charges.filter((charge) => charge.status === 'COMPLETED');
  const pending = data.charges.filter((charge) => charge.status === 'PENDING');
  const total = completed.reduce((sum, charge) => sum + charge.amount, 0);
  const approval = data.charges.length ? Math.round((completed.length / data.charges.length) * 100) : 0;
  const recent = [...data.charges].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
  const monthBars = Array.from({ length: 12 }, (_, index) => {
    const month = new Date();
    month.setMonth(month.getMonth() - (11 - index), 1);
    const totalForMonth = data.charges.filter((charge) => charge.status === 'COMPLETED' && new Date(charge.createdAt).getMonth() === month.getMonth() && new Date(charge.createdAt).getFullYear() === month.getFullYear()).reduce((sum, charge) => sum + charge.amount, 0);
    return { label: new Intl.DateTimeFormat('pt-BR', { month: 'short' }).format(month), value: totalForMonth };
  });
  const maxMonth = Math.max(...monthBars.map((bar) => bar.value), 1);

  return <div className="page-stack"><PageHeading eyebrow={currentDate({ weekday: 'long', day: '2-digit', month: 'long' }).toLocaleUpperCase('pt-BR')} title="Visao geral" description="Indicadores calculados a partir dos pagamentos registrados no Supabase." action={<button className="button button-primary" onClick={() => openDialog('charge')}><Plus size={16} /> Criar cobranca Pix</button>} />
    <section className="metric-grid"><MetricCard label="Recebido" value={money(total)} note="Somente pagamentos confirmados pelo provedor" icon={ArrowDownToLine} tone="mint" /><MetricCard label="Aguardando Pix" value={String(pending.length)} note="Cobrancas aguardando confirmacao" icon={Clock3} tone="gold" /><MetricCard label="Aprovacao" value={`${approval}%`} note="Baseada em registros reais" icon={BadgeCheck} tone="blue" /><MetricCard label="Clientes" value={String(data.customers.length)} note={`${data.links.length} links cadastrados`} icon={Users} tone="coral" /></section>
    <section className="dashboard-grid"><article className="surface chart-surface"><div className="surface-heading"><div><p className="eyebrow">DADOS DO SUPABASE</p><h2>Pagamentos concluidos</h2></div><span className="date-filter"><CalendarDays size={14} /> 12 meses</span></div><div className="chart-total"><strong>{money(total)}</strong><span>total confirmado</span></div><div className="bar-chart" role="img" aria-label="Volume mensal de pagamentos confirmados">{monthBars.map((bar, index) => <div className="bar-column" key={`${bar.label}-${index}`}><div className={`bar-fill ${index === 11 ? 'bar-current' : ''}`} style={{ height: `${Math.max(bar.value / maxMonth * 100, 2)}%` }} /><span>{bar.label}</span></div>)}</div></article>
      <article className="surface activity-surface"><div className="surface-heading"><div><p className="eyebrow">PROVEDOR</p><h2>Atividade recente</h2></div><Activity size={18} className="muted-icon" /></div>{recent.length ? <div className="activity-list">{recent.map((charge) => <div className="activity-row" key={charge.id}><div className="activity-mark"><CreditCard size={16} /></div><div className="activity-copy"><strong>{charge.customer}</strong><span>{charge.method} · {dateTime(charge.createdAt)}</span></div><div className="activity-amount"><strong>{money(charge.amount)}</strong><StatusBadge status={charge.status} /></div></div>)}</div> : <EmptyState title="Sem cobrancas ainda" message="Crie uma cobranca Pix para registrar a primeira transacao real." />}</article></section>
    <section className="lower-grid"><article className="surface quick-surface"><div className="surface-heading"><div><p className="eyebrow">OPERACAO</p><h2>Atalhos</h2></div></div><div className="quick-actions"><button onClick={() => openDialog('charge')}><span className="quick-icon mint"><CreditCard size={17} /></span><span><strong>Criar cobranca Pix</strong><small>Solicitar Pix ao provedor</small></span><Plus size={16} /></button><button onClick={() => openDialog('deposit')}><span className="quick-icon mint"><ArrowDownToLine size={17} /></span><span><strong>Depositar via Pix</strong><small>Gerar Pix para deposito</small></span><Plus size={16} /></button><button onClick={() => openDialog('link')}><span className="quick-icon blue"><Link2 size={17} /></span><span><strong>Criar link</strong><small>Checkout Pix ativo</small></span><Plus size={16} /></button><button onClick={() => openDialog('customer')}><span className="quick-icon gold"><Users size={17} /></span><span><strong>Adicionar cliente</strong><small>Salvar no Supabase</small></span><Plus size={16} /></button></div></article><article className="readiness-panel"><div className="readiness-icon"><ShieldCheck size={19} /></div><p className="eyebrow">PAGAMENTOS</p><h2>Status vem do provedor.</h2><p>Uma cobranca permanece pendente ate que o provedor confirme a liquidacao. Nenhum status e alterado manualmente pelo navegador.</p><NavLink to="/integrations" className="text-link">Ver configuracao <ArrowUpRight size={14} /></NavLink></article></section>
  </div>;
}

function ChargesPage({ charges, openDialog }: { charges: Charge[]; openDialog: (kind: DialogKind) => void }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');
  const filtered = useMemo(() => charges.filter((charge) => `${charge.id} ${charge.identifier} ${charge.customer} ${charge.email} ${charge.method} ${charge.amount} ${money(charge.amount)}`.toLowerCase().includes(search.toLowerCase()) && (status === 'ALL' || charge.status === status)), [charges, search, status]);
  return <div className="page-stack"><PageHeading eyebrow="OPERACAO" title="Cobrancas" description="Registros persistidos e status retornado pelo provedor." action={<button className="button button-primary" onClick={() => openDialog('charge')}><Plus size={16} /> Criar cobranca Pix</button>} /><section className="surface table-surface"><div className="table-toolbar"><label className="search-box"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar cliente, referencia ou valor" /></label><select className="select-control" value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filtrar status"><option value="ALL">Todos</option><option value="COMPLETED">Concluido</option><option value="PENDING">Pendente</option><option value="FAILED">Falhou</option></select><span className="result-count">{filtered.length} registros</span></div>{filtered.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Referencia</th><th>Cliente</th><th>Metodo</th><th>Data</th><th>Valor</th><th>Status</th></tr></thead><tbody>{filtered.map((charge) => <tr key={charge.id}><td><span className="primary-cell">{charge.identifier}</span><small>{charge.id}</small></td><td><span className="primary-cell">{charge.customer}</span><small>{charge.email}</small></td><td>{charge.method}</td><td>{dateTime(charge.createdAt)}</td><td className="amount-cell">{money(charge.amount)}</td><td><StatusBadge status={charge.status} /></td></tr>)}</tbody></table></div> : <EmptyState title="Nenhuma cobranca encontrada" message="Os resultados desta lista vem do seu projeto Supabase." />}</section></div>;
}

function LinksPage({ links, openDialog }: { links: PaymentLink[]; openDialog: (kind: DialogKind) => void }) {
  return <div className="page-stack"><PageHeading eyebrow="CHECKOUT PIX" title="Links de pagamento" description="Links salvos no Supabase; o valor do checkout e consultado no servidor." action={<button className="button button-primary" onClick={() => openDialog('link')}><Plus size={16} /> Criar link</button>} /><div className="notice notice-amber"><ShieldCheck size={17} /><p><strong>Atenção:</strong> para criar um link de pagamento, você precisa já ter movimentado dinheiro na sua conta.</p></div>{links.length ? <div className="link-grid">{links.map((link) => { const url = `${window.location.origin}/checkout/${link.id}`; return <article className="link-card" key={link.id}><div className="link-card-top"><span className="link-symbol"><Link2 size={17} /></span><StatusBadge status={link.status} /></div><p className="eyebrow">LINK PIX</p><h2>{link.name}</h2><strong className="link-price">{money(link.amount)}</strong><p className="link-created">Criado em {shortDate(link.createdAt)}</p><div className="link-url"><span>{url}</span><button aria-label="Copiar link" title="Copiar link" onClick={() => void copyText(url)}><Copy size={15} /></button></div><a className="button button-secondary link-open" href={url} target="_blank" rel="noreferrer">Abrir checkout <ExternalLink size={14} /></a></article>; })}</div> : <section className="surface"><EmptyState title="Nenhum link cadastrado" message="Crie um link para receber pagamentos Pix." action={<button className="button button-primary" onClick={() => openDialog('link')}><Plus size={15} /> Criar link</button>} /></section>}</div>;
}

function CustomersPage({ customers, charges, openDialog }: { customers: Customer[]; charges: Charge[]; openDialog: (kind: DialogKind) => void }) {
  const [search, setSearch] = useState('');
  const filtered = customers.filter((customer) => `${customer.name} ${customer.email}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="page-stack"><PageHeading eyebrow="RELACIONAMENTO" title="Clientes" description="Contatos armazenados no Supabase e protegidos por RLS." action={<button className="button button-primary" onClick={() => openDialog('customer')}><Plus size={16} /> Adicionar cliente</button>} /><label className="search-box customer-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar nome ou e-mail" /></label>{filtered.length ? <div className="customer-grid">{filtered.map((customer) => { const customerCharges = charges.filter((charge) => charge.email === customer.email && charge.status === 'COMPLETED'); return <article className="customer-card" key={customer.id}><div className="customer-card-head"><div className="avatar">{customer.name.split(' ').map((part) => part[0]).slice(0, 2).join('')}</div><span className="customer-since">Desde {shortDate(customer.createdAt)}</span></div><h2>{customer.name}</h2><a href={`mailto:${customer.email}`}>{customer.email}</a><p className="customer-phone">{customer.phone || 'Telefone nao informado'}</p><div className="customer-card-foot"><span>Pagamentos concluidos</span><strong>{customerCharges.length} · {money(customerCharges.reduce((sum, charge) => sum + charge.amount, 0))}</strong></div></article>; })}</div> : <section className="surface"><EmptyState title="Nenhum cliente encontrado" message="Adicione um cliente ou altere a busca." /></section>}</div>;
}

function DocumentsPage({ documents, charges, openDialog, onDownload }: { documents: SavedDocument[]; charges: Charge[]; openDialog: (kind: DialogKind) => void; onDownload: (document: SavedDocument) => void }) {
  return <div className="page-stack"><PageHeading eyebrow="RECIBOS" title="Documentos" description="Recibos vinculados a cobrancas confirmadas no banco." action={<button className="button button-primary" onClick={() => openDialog('document')} disabled={!charges.some((charge) => charge.status === 'COMPLETED')}><Plus size={16} /> Gerar recibo</button>} /><section className="surface document-surface">{documents.length ? <div className="document-list">{documents.map((document) => { const charge = charges.find((item) => item.id === document.chargeId); return <div className="document-row" key={document.id}><div className="document-mark"><FileText size={18} /></div><div className="document-details"><strong>{document.title}</strong><span>{document.type === 'RECEIPT' ? 'Recibo' : 'Comprovante'} · {dateTime(document.createdAt)}{charge ? ` · ${money(charge.amount)}` : ''}</span></div><button className="icon-button" onClick={() => onDownload(document)} aria-label={`Baixar ${document.title}`} title="Baixar arquivo"><ArrowDownToLine size={17} /></button></div>; })}</div> : <EmptyState title="Nenhum recibo" message="O recibo so pode ser criado para uma cobranca confirmada pelo provedor." />}</section><div className="notice notice-amber"><FileText size={17} /><p><strong>Nota fiscal:</strong> NFS-e exige integracao com provedor fiscal autorizado. Este modulo gera apenas recibos de pagamento.</p></div></div>;
}

function AccountsPage({ charges }: { charges: Charge[] }) {
  const completed = charges.filter((charge) => charge.status === 'COMPLETED').reduce((sum, charge) => sum + charge.amount - charge.fee, 0);
  return <div className="page-stack"><PageHeading eyebrow="LIQUIDACAO" title="Saldos e repasses" description="Valores derivados de cobrancas confirmadas. Saldo bancario exige integracao bancaria propria." /><section className="metric-grid account-metrics"><MetricCard label="Liquido de cobrancas confirmadas" value={money(completed)} note="Total pago menos taxas registradas" icon={Wallet} tone="mint" /><MetricCard label="Conta bancaria" value="Nao conectada" note="Nenhum saldo externo consultado" icon={ShieldCheck} tone="gold" /><MetricCard label="Repasses" value="Indisponivel" note="Este provedor Pix nao oferece saque nesta integracao" icon={ArrowUpRight} tone="coral" /></section><div className="notice notice-amber"><ShieldCheck size={17} /><p>O valor liquido e uma soma dos registros confirmados, nao um saldo bancario nem uma garantia de liquidacao.</p></div></div>;
}

function IntegrationsPage() {
  return <div className="page-stack"><PageHeading eyebrow="CONFIGURACAO" title="Integracoes" description="Estado dos servicos usados pelo painel e pelo checkout." /><section className="integration-list"><article className="integration-row"><div className="integration-logo database-logo">DB</div><div className="integration-copy"><div><h2>Supabase Auth e Postgres</h2><span className="integration-status">Sessao ativa</span></div><p>Clientes, links, cobrancas e recibos usam tabelas com Row Level Security por usuario.</p><code>supabase/migrations/20261028000001_gateway_tables.sql</code></div><StatusBadge status="ACTIVE" /></article><article className="integration-row"><div className="integration-logo poseidon-logo">P</div><div className="integration-copy"><div><h2>Poseidon Pay · Pix</h2><span className="integration-status">Checkout no backend</span></div><p>Credenciais ficam no ambiente do servidor. O pagamento permanece pendente ate confirmacao do provedor.</p><code>POSEIDON_PUBLIC_KEY · POSEIDON_SECRET_KEY</code></div><StatusBadge status="PENDING" /></article><article className="integration-row"><div className="integration-logo webhook-logo"><Activity size={19} /></div><div className="integration-copy"><div><h2>Confirmacao de status</h2><span className="integration-status">Webhook necessita homologacao</span></div><p>Para atualizar cobrancas depois do pagamento, configure o callback oficial do Poseidon e valide o webhookToken.</p><code>Callback HTTPS · assinatura do provedor</code></div><StatusBadge status="PENDING" /></article></section></div>;
}

function CreateDialog({ kind, customers, charges, onClose, onSubmit }: { kind: DialogKind; customers: Customer[]; charges: Charge[]; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const titles = { charge: 'Criar cobranca Pix', deposit: 'Depositar via Pix', link: 'Criar link Pix', customer: 'Adicionar cliente', document: 'Gerar recibo' };
  return <div className="dialog-backdrop"><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div className="dialog-heading"><div><p className="eyebrow">SUPABASE + POSEIDON</p><h2 id="dialog-title">{titles[kind]}</h2></div><button className="icon-button" onClick={onClose} aria-label="Fechar"><X size={18} /></button></div><form className="form-stack" onSubmit={onSubmit}>
    {kind === 'charge' && <><label>Cliente<select name="customerId" required defaultValue=""><option value="" disabled>Selecione um cliente</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name} · {customer.email}</option>)}</select></label><div className="form-grid"><label>Valor (R$)<input name="amount" type="number" min="0.01" step="0.01" required placeholder="0,00" /></label><label>Metodo<input value="PIX" readOnly /></label></div></>}
    {kind === 'deposit' && <><label>Seu nome<input name="name" required maxLength={120} autoComplete="name" /></label><label>Seu e-mail<input name="email" type="email" required maxLength={160} autoComplete="email" /></label><label>CPF ou CNPJ<input name="document" required maxLength={20} autoComplete="off" placeholder="Somente numeros ou com pontuacao" /></label><label>Telefone<input name="phone" type="tel" required maxLength={30} autoComplete="tel" placeholder="(11) 99999-9999" /></label><label>Valor do deposito (R$)<input name="amount" type="number" min="0.01" step="0.01" required placeholder="0,00" /></label><p className="connection-note">Informe os dados exigidos pelo gateway. O Pix fica pendente ate confirmacao; os limites de valor dependem da sua conta Poseidon. Esta solicitacao nao credita saldo no PayFlow.</p></>}
    {kind === 'link' && <><div className="notice notice-amber"><ShieldCheck size={17} /><p><strong>Criação de link bloqueada</strong><br />Conforme a exigência da sua conta, é necessário já ter movimentado dinheiro antes de criar links de pagamento. O PayFlow não consegue verificar essa movimentação automaticamente. Depois de movimentar a conta, confirme a liberação com a Poseidon e solicite a reativação desta opção. Até lá, o botão de confirmação permanece desabilitado.</p></div><label>Nome do produto ou servico<input name="name" required maxLength={80} placeholder="Ex.: Consultoria" /></label><label>Valor (R$)<input name="amount" type="number" min="0.01" step="0.01" required placeholder="0,00" /></label></>}
    {kind === 'customer' && <><label>Nome completo<input name="name" required maxLength={120} placeholder="Nome do cliente" /></label><label>E-mail<input name="email" type="email" required maxLength={160} placeholder="cliente@empresa.com" /></label><label>Telefone<input name="phone" type="tel" maxLength={30} placeholder="(11) 99999-9999" /></label></>}
    {kind === 'document' && <><label>Cobranca confirmada<select name="chargeId" required defaultValue=""><option value="" disabled>Selecione</option>{charges.filter((charge) => charge.status === 'COMPLETED').map((charge) => <option key={charge.id} value={charge.id}>{charge.identifier} · {charge.customer} · {money(charge.amount)}</option>)}</select></label><label>Tipo<select name="type" defaultValue="RECEIPT"><option value="RECEIPT">Recibo</option><option value="PAYMENT_CONFIRMATION">Comprovante</option></select></label></>}
    <div className="dialog-actions"><button type="button" className="button button-quiet" onClick={onClose}>Cancelar</button><button type="submit" className="button button-primary" disabled={kind === 'link'}><Check size={15} />{kind === 'link' ? 'Bloqueado' : 'Confirmar'}</button></div>
  </form></section></div>;
}

function PixResultDialog({ result, onClose }: { result: PixResponse; onClose: () => void }) {
  async function copyPix() {
    try { await navigator.clipboard.writeText(result.pix.code); toast.success('Codigo Pix copiado.'); }
    catch { toast.error('Nao foi possivel copiar o codigo Pix.'); }
  }
  return <div className="dialog-backdrop"><section className="dialog pix-result" role="dialog" aria-modal="true" aria-labelledby="pix-title"><div className="dialog-heading"><div><p className="eyebrow">RESPOSTA DO POSEIDON</p><h2 id="pix-title">{result.purpose === 'deposit' ? 'Pix para deposito criado' : 'Pix criado'}</h2></div><button className="icon-button" onClick={onClose} aria-label="Fechar"><X size={18} /></button></div><div className="pix-status"><StatusBadge status={result.status} /><span>Transacao {result.transactionId}</span></div>{result.pix.image && <img className="pix-qr-image" src={result.pix.image} alt="QR Code Pix fornecido pelo provedor" />}<label className="pix-code-label">Codigo Pix copia e cola<textarea readOnly value={result.pix.code} rows={4} /></label><button className="button button-primary pix-copy-button" onClick={() => void copyPix()}><Copy size={15} /> Copiar codigo Pix</button>{result.pix.expiresAt && <p className="connection-note">Expira em {dateTime(result.pix.expiresAt)}</p>}<p className="connection-note">{result.purpose === 'deposit' ? 'O deposito continua pendente. Nenhum saldo foi creditado; aguarde a confirmacao oficial do provedor.' : 'A cobranca fica pendente ate confirmacao recebida do provedor.'}</p></section></div>;
}

function CheckoutPage() {
  const { id = '' } = useParams();
  const [link, setLink] = useState<{ id: string; name: string; amount: number } | null>(null);
  const [loadingLink, setLoadingLink] = useState(true);
  const [result, setResult] = useState<PixResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void fetch(`/api/v1/checkout/${encodeURIComponent(id)}`)
      .then(async (response) => {
        const body = await response.json() as { id?: string; name?: string; amount?: number; message?: string };
        if (!response.ok) throw new Error(body.message ?? 'Link de pagamento inexistente ou inativo.');
        if (!body.id || !body.name || typeof body.amount !== 'number') throw new Error('O provedor retornou dados invalidos para este link.');
        if (active) setLink({ id: body.id, name: body.name, amount: body.amount });
      })
      .catch((requestError: unknown) => {
        if (active) setError(requestError instanceof Error ? requestError.message : 'Nao foi possivel consultar o link.');
      })
      .finally(() => { if (active) setLoadingLink(false); });
    return () => { active = false; };
  }, [id]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const formData = new FormData(event.currentTarget);
    const identifier = crypto.randomUUID();
    try {
      const response = await fetch(`/api/v1/checkout/${encodeURIComponent(id)}/pix`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, client: { name: String(formData.get('name')).trim(), email: String(formData.get('email')).trim(), phone: String(formData.get('phone') ?? '').trim() || undefined } }),
      });
      const body = await response.json() as PixResponse & ApiErrorResponse;
      if (!response.ok) throw new Error(getApiErrorMessage(body, 'O provedor nao aceitou a cobranca.'));
      setResult(body);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Nao foi possivel criar o Pix.');
    } finally {
      setBusy(false);
    }
  }

  return <main className="checkout-page"><header className="checkout-brand"><img className="brand-mark brand-logo" src="/payflow-logo.jpg" alt="Logo PayFlow" /><span>PAYFLOW<small>CHECKOUT</small></span></header><section className="checkout-panel"><p className="eyebrow">PAGAMENTO PIX</p>{loadingLink ? <div className="loading-state"><span className="loading-spinner" /><p>Consultando link...</p></div> : error && !link ? <><h1>Link indisponivel</h1><p className="form-error">{error}</p></> : link && <><h1>{link.name}</h1><p className="checkout-amount">{money(link.amount)}</p>{result ? <><div className="pix-status"><StatusBadge status={result.status} /><span>Transacao {result.transactionId}</span></div>{result.pix.image && <img className="pix-qr-image" src={result.pix.image} alt="QR Code Pix fornecido pelo provedor" />}<label className="pix-code-label">Codigo Pix copia e cola<textarea readOnly value={result.pix.code} rows={4} /></label><button className="button button-primary checkout-submit" onClick={() => void navigator.clipboard.writeText(result.pix.code).then(() => toast.success('Codigo Pix copiado.'))}><Copy size={15} /> Copiar codigo Pix</button><p className="checkout-legal">Aguardando confirmacao do provedor. Nao feche esta tela antes de copiar o codigo.</p></> : <form className="form-stack" onSubmit={submit}><label>Nome<input name="name" autoComplete="name" required maxLength={120} /></label><label>E-mail<input name="email" type="email" autoComplete="email" required maxLength={160} /></label><label>Telefone <span className="optional-label">se exigido pelo provedor</span><input name="phone" autoComplete="tel" maxLength={30} /></label>{error && <p className="form-error">{error}</p>}<button type="submit" className="button button-primary checkout-submit" disabled={busy}>{busy ? 'Consultando provedor...' : 'Gerar cobranca Pix'} <ArrowUpRight size={16} /></button><p className="checkout-legal">O valor vem do link. O Pix sera criado pelo provedor.</p></form>}</>}</section><footer className="checkout-footer">Pagamento processado pelo provedor</footer></main>;
}

function Workspace({ client, session, onSignOut }: { client: SupabaseClient; session: Session; onSignOut: () => void }) {
  const location = useLocation();
  const pageTitle = navItems.find((item) => item.to === location.pathname)?.label ?? 'Visao geral';
  const [data, setData] = useState<LiveData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [pixResult, setPixResult] = useState<PixResponse | null>(null);

  async function refreshData() {
    setLoading(true);
    const [chargesResult, customersResult, linksResult, documentsResult] = await Promise.all([
      client.from('charges').select('*').order('created_at', { ascending: false }),
      client.from('customers').select('*').order('created_at', { ascending: false }),
      client.from('payment_links').select('*').order('created_at', { ascending: false }),
      client.from('documents').select('*').order('created_at', { ascending: false }),
    ]);
    const failed = [chargesResult.error, customersResult.error, linksResult.error, documentsResult.error].find(Boolean);
    if (failed) {
      toast.error(`Falha ao carregar o Supabase: ${failed.message}`);
      setLoading(false);
      return;
    }
    setData({
      charges: (chargesResult.data ?? []).map((row) => fromChargeRow(row as Record<string, unknown>)),
      customers: (customersResult.data ?? []).map((row) => fromCustomerRow(row as Record<string, unknown>)),
      links: (linksResult.data ?? []).map((row) => fromLinkRow(row as Record<string, unknown>)),
      documents: (documentsResult.data ?? []).map((row) => fromDocumentRow(row as Record<string, unknown>)),
    });
    setLoading(false);
  }

  useEffect(() => {
    document.title = `PayFlow · ${pageTitle}`;
  }, [pageTitle]);

  useEffect(() => {
    void refreshData();
  }, [session.user.id]);

  async function createRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialog) return;
    if (dialog === 'link') {
      toast.error('A criação de links está bloqueada até a movimentação da conta ser confirmada pela Poseidon.');
      return;
    }
    const form = event.currentTarget;
    const formData = new FormData(form);
    try {
      if (dialog === 'customer') {
        const { error } = await client.from('customers').insert({ name: String(formData.get('name')).trim(), email: String(formData.get('email')).trim().toLowerCase(), phone: String(formData.get('phone') ?? '').trim() });
        if (error) throw error;
        toast.success('Cliente salvo no Supabase.');
      }

      if (dialog === 'charge' || dialog === 'deposit') {
        const customer = dialog === 'charge'
          ? data.customers.find((item) => item.id === String(formData.get('customerId')))
          : null;
        const amount = Number(formData.get('amount'));
        const name = customer?.name ?? String(formData.get('name') ?? '').trim();
        const email = customer?.email ?? String(formData.get('email') ?? '').trim().toLowerCase();
        const phone = customer?.phone ?? String(formData.get('phone') ?? '').trim();
        const document = dialog === 'deposit' ? String(formData.get('document') ?? '').trim() : undefined;
        if ((!customer && (dialog === 'charge' || !name || !email || !phone || !document)) || !Number.isFinite(amount) || amount <= 0) {
          throw new Error(dialog === 'deposit' ? 'Informe seus dados e um valor valido.' : 'Selecione um cliente e informe um valor valido.');
        }
        const response = await fetch('/api/v1/gateway/pix/receive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ identifier: crypto.randomUUID(), amount, client: { name, email, phone: phone || undefined, document } }),
        });
        const body = await response.json() as PixResponse & ApiErrorResponse;
        if (!response.ok) throw new Error(getApiErrorMessage(body, 'O provedor nao aceitou a cobranca.'));
        await refreshData();
        setDialog(null);
        setPixResult({ ...body, purpose: dialog });
        return;
      }

      if (dialog === 'document') {
        const charge = data.charges.find((item) => item.id === String(formData.get('chargeId')) && item.status === 'COMPLETED');
        if (!charge) throw new Error('Selecione uma cobranca confirmada pelo provedor.');
        const type = String(formData.get('type')) as SavedDocument['type'];
        const { error } = await client.from('documents').insert({ charge_id: charge.id, title: `${type === 'RECEIPT' ? 'Recibo' : 'Comprovante'} ${charge.identifier}`, type });
        if (error) throw error;
        toast.success('Documento registrado.');
      }

      setDialog(null);
      await refreshData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'A operacao falhou.');
    }
  }

  function downloadDocument(item: SavedDocument) {
    const charge = data.charges.find((current) => current.id === item.chargeId);
    if (!charge || charge.status !== 'COMPLETED') return toast.error('So pagamentos confirmados podem gerar recibo.');
    const content = ['PAYFLOW - RECIBO DE PAGAMENTO', `Documento: ${item.title}`, `Emitido em: ${dateTime(item.createdAt)}`, `Cliente: ${charge.customer}`, `E-mail: ${charge.email}`, `Referencia: ${charge.identifier}`, `Metodo: ${charge.method}`, `Valor: ${money(charge.amount)}`, `Taxa registrada: ${money(charge.fee)}`, 'Pagamento confirmado pelo provedor.', 'Este recibo nao substitui nota fiscal.'].join('\n');
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
    const anchor = window.document.createElement('a');
    anchor.href = url;
    anchor.download = `${item.id}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return <div className="app-shell"><aside className="sidebar"><Link to="/dashboard" className="brand-lockup"><img className="brand-mark brand-logo" src="/payflow-logo.jpg" alt="Logo PayFlow" /><span>PAYFLOW<small>PAYMENTS PLATFORM</small></span></Link><div className="workspace-chip"><span className="workspace-avatar">{(session.user.email ?? 'PF').slice(0, 2).toUpperCase()}</span><span><strong>{session.user.email}</strong><small>Conta conectada</small></span></div><p className="nav-caption">CONTA</p><nav className="side-nav" aria-label="Navegacao principal">{navItems.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} className={({ isActive }) => `nav-link ${isActive ? 'nav-link-active' : ''}`}><Icon size={17} strokeWidth={1.8} /><span>{label}</span>{to === '/charges' && <span className="nav-count">{data.charges.length}</span>}</NavLink>)}</nav><div className="sidebar-bottom"><div className="security-note"><ShieldCheck size={16} /><span><strong>Dados protegidos por RLS</strong><small>Escopo isolado pela sessao Supabase.</small></span></div><button className="reset-button" onClick={onSignOut}><LogOut size={14} /> Sair da conta</button></div></aside>
    <div className="main-column"><header className="topbar"><div className="breadcrumb"><span>Workspace</span><span>/</span><strong>{pageTitle}</strong></div><div className="topbar-right"><span className="live-indicator"><span />CONECTADO</span><span className="topbar-date">{currentDate({ day: '2-digit', month: 'short', year: 'numeric' })}</span><div className="user-avatar" title={session.user.email}>{(session.user.email ?? 'PF').slice(0, 2).toUpperCase()}</div></div></header><main className="main-content">{loading ? <div className="loading-state"><span className="loading-spinner" /><p>Carregando dados protegidos...</p></div> : <Routes><Route path="/" element={<Navigate to="/dashboard" replace />} /><Route path="/dashboard" element={<DashboardPage data={data} openDialog={setDialog} />} /><Route path="/charges" element={<ChargesPage charges={data.charges} openDialog={setDialog} />} /><Route path="/links" element={<LinksPage links={data.links} openDialog={setDialog} />} /><Route path="/customers" element={<CustomersPage customers={data.customers} charges={data.charges} openDialog={setDialog} />} /><Route path="/documents" element={<DocumentsPage documents={data.documents} charges={data.charges} openDialog={setDialog} onDownload={downloadDocument} />} /><Route path="/accounts" element={<AccountsPage charges={data.charges} />} /><Route path="/integrations" element={<IntegrationsPage />} /></Routes>}<footer className="app-footer"><span>PayFlow · Conta Supabase</span><span>Pagamentos e status sincronizados com o provedor</span></footer></main></div>{dialog && <CreateDialog kind={dialog} customers={data.customers} charges={data.charges} onClose={() => setDialog(null)} onSubmit={createRecord} />}{pixResult && <PixResultDialog result={pixResult} onClose={() => setPixResult(null)} />}</div>;
}

function copyText(value: string) {
  return navigator.clipboard.writeText(value).then(() => toast.success('Copiado.')).catch(() => toast.error('Nao foi possivel copiar.'));
}

function AuthenticatedWorkspace({ client }: { client: SupabaseClient }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    void client.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
    const { data: listener } = client.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => listener.subscription.unsubscribe();
  }, [client]);
  if (loading) return <main className="connection-page"><div className="loading-state"><span className="loading-spinner" /><p>Verificando sessao...</p></div></main>;
  if (!session) return <AuthPage client={client} />;
  return <Workspace client={client} session={session} onSignOut={() => void client.auth.signOut()} />;
}

export default function LivePayFlowApp() {
  const location = useLocation();
  useEffect(() => {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith('payflow.demo.')) window.localStorage.removeItem(key);
    }
  }, []);
  if (location.pathname.startsWith('/checkout/')) return <Routes><Route path="/checkout/:id" element={<CheckoutPage />} /></Routes>;
  if (!isSupabaseConfigured || !supabase) return <ConfigurationPage />;
  return <AuthenticatedWorkspace client={supabase} />;
}