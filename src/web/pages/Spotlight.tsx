import { Layout } from '../components/Layout';
import type { StoreState } from '../store';

export function Spotlight({ store }: { store: StoreState }) {
  return (
    <Layout logo={store.snapshot?.theme.logo} leagueName={store.snapshot?.leagueName}>
      <div className="text-6xl">Spotlight</div>
    </Layout>
  );
}
