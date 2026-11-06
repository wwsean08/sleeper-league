import { Layout } from '../components/Layout';
import type { StoreState } from '../store';

export function Schedule({ store }: { store: StoreState }) {
  return (
    <Layout logo={store.snapshot?.theme.logo} leagueName={store.snapshot?.leagueName}>
      <div className="text-6xl">Schedule</div>
    </Layout>
  );
}
