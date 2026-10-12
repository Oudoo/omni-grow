'use client';
import { useState } from 'react';
import useSWR from 'swr';
import { ArrowDownLeft, ArrowUpRight, CircleCheck, Clock3, MessageCircle } from 'lucide-react';
import { api } from '@/lib/client';
import { ErrorNotice, Loading, PanelHeading } from './ui';
interface ReportSummary { conversations_count: number; incoming_messages_count: number; outgoing_messages_count: number; resolutions_count: number; avg_first_response_time: number | null; avg_resolution_time: number | null }
export function Reports() {
  const [days, setDays] = useState(7);
  const until = Math.floor(Date.now() / 1000), since = until - (days - 1) * 86400;
  // Fixed daily boundaries keep the SWR key stable as the UI rerenders.
  const sinceDay = Math.floor(since / 86400) * 86400, untilDay = Math.floor(until / 86400) * 86400 + 86399;
  const params = `type=account&since=${sinceDay}&until=${untilDay}&timezone_offset=${-new Date().getTimezoneOffset() / 60}`;
  const { data, error, isLoading, mutate } = useSWR<ReportSummary>(`reports/summary?${params}`, api);
  const { data: series, error: seriesError, isLoading: seriesLoading, mutate: reloadSeries } = useSWR<{ timestamp: number; value: number }[]>(`reports?${params}&metric=conversations_count&group_by=day`, api);
  const maximum = Math.max(1, ...(series || []).map(p => p.value));
  const duration = (seconds: number | null | undefined) => seconds == null ? '—' : seconds < 60 ? `${Math.round(seconds)}s` : seconds < 3600 ? `${Math.round(seconds / 60)}m` : `${(seconds / 3600).toFixed(1)}h`;
  const metrics = [
    { name: 'Conversations', value: data?.conversations_count, icon: MessageCircle, color: 'green', help: 'Customer conversations started' },
    { name: 'Incoming messages', value: data?.incoming_messages_count, icon: ArrowDownLeft, color: 'blue', help: 'Messages from your customers' },
    { name: 'Outgoing messages', value: data?.outgoing_messages_count, icon: ArrowUpRight, color: 'purple', help: 'Replies sent by your team' },
    { name: 'Resolved', value: data?.resolutions_count, icon: CircleCheck, color: 'orange', help: 'Conversations brought to a close' }
  ];
  return <><PanelHeading eyebrow="A CLEARER VIEW OF YOUR WORK" title="Every reply matters" description="Understand the rhythm of your conversations and the impact of your team." action={<select className="period-select" aria-label="Report period" value={days} onChange={e => setDays(Number(e.target.value))}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></select>} /><ErrorNotice error={error} retry={() => mutate()} />{isLoading ? <Loading /> : <><div className="metric-grid">{metrics.map(metric => <article className="metric-card" key={metric.name}><div><span>{metric.name}</span><span className={`metric-icon ${metric.color}`}><metric.icon size={19} /></span></div><strong>{metric.value?.toLocaleString() ?? '—'}</strong><p>{metric.help}</p></article>)}</div><div className="reports-grid"><article className="data-panel chart-panel"><div className="section-title"><div><h2>Conversation activity</h2><p className="muted">New conversations, day by day</p></div><span>LAST {days} DAYS</span></div><ErrorNotice error={seriesError} retry={() => reloadSeries()} />{seriesLoading && <Loading label="Loading conversation activity…" />}<div className="bar-chart" role="img" aria-label={`Daily new conversations over the last ${days} days`}>{series?.map(point => <div className="bar-column" key={point.timestamp}><span>{point.value}</span><div style={{ height: `${point.value / maximum * 180}px` }} title={`${new Date(point.timestamp * 1000).toLocaleDateString()}: ${point.value} conversations`} /><small>{new Date(point.timestamp * 1000).toLocaleDateString([], { day: 'numeric', month: 'short' })}</small></div>)}</div>{!seriesError && !seriesLoading && !series?.some(p => p.value > 0) && <p className="chart-empty">Your activity will take shape as real conversations arrive.</p>}</article><article className="data-panel response-panel"><span className="metric-icon green"><Clock3 size={22} /></span><h2>A timely response<br />goes a long way.</h2><div className="response-stat"><span>Average first response</span><strong>{duration(data?.avg_first_response_time)}</strong></div><div className="response-stat"><span>Average resolution</span><strong>{duration(data?.avg_resolution_time)}</strong></div><p className="muted">Calculated from recorded messaging events in the selected period. A dash means there are no measured responses yet.</p></article></div></>}</>;
}
