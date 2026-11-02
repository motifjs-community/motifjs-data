import type { data } from '@motifx-community/data';
import type { Follow } from '../follow';

/** Loading, the error with a retry button, or the row count. */
export function SourceStatus(props: { source: data.DataSource<never, never>; follow: Follow; extra?: () => string }) {
  const { source, follow } = props;
  const text = () =>
    follow.read(() => {
      if (source.status === 'loading' || source.status === 'idle') return 'Loading…';
      if (source.status === 'error') return source.error?.plainMessage ?? 'Failed';
      const total = source.total === undefined ? '' : `${source.total.toLocaleString('en-US')} rows`;
      return [total, props.extra?.()].filter(Boolean).join(' · ');
    });
  return (
    <p class={() => follow.read(() => (source.status === 'error' ? 'demo-status is-error' : 'demo-status'))} role="status">
      <span>{text}</span>
      <button type="button" class="demo-chip" x-wait={() => follow.read(() => source.status !== 'error')} onclick={() => void source.retry()}>
        Retry
      </button>
    </p>
  );
}
