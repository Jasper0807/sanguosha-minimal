import { useGameStore } from './store/gameStore';
import { LobbyView } from './views/LobbyView';
import { GameTableView } from './views/GameTableView';
import { SummaryView } from './views/SummaryView';
import { CardDetailModal } from './components/CardDetailModal';
import { RulesModal } from './components/RulesModal';

export default function App() {
  const { screen, inspectCard, showRulesModal, setInspectCard, setShowRulesModal } = useGameStore();

  return (
    <>
      {screen === 'lobby' && (
        <LobbyView
          availableModes={['1v1', '2v2', 'identity5']}
          availableDecks={['standard_ex', 'junzheng_161']}
        />
      )}
      {screen === 'table' && <GameTableView />}
      {screen === 'summary' && <SummaryView />}

      <CardDetailModal card={inspectCard} onClose={() => setInspectCard(null)} />
      <RulesModal open={showRulesModal} onClose={() => setShowRulesModal(false)} />
    </>
  );
}
