import { useEffect, useState } from 'react';
import { useGameStore } from './store/gameStore';
import { getSavedRoomToken, useOnlineStore } from './store/onlineStore';
import { LobbyView } from './views/LobbyView';
import { GameTableView } from './views/GameTableView';
import { SummaryView } from './views/SummaryView';
import { OnlineRoomView } from './views/OnlineRoomView';
import { OnlineGameTableView } from './views/OnlineGameTableView';
import { CardDetailModal } from './components/CardDetailModal';
import { RulesModal } from './components/RulesModal';

export default function App() {
  const { screen, inspectCard, showRulesModal, setInspectCard, setShowRulesModal } =
    useGameStore();
  const { room, nickname, joinRoom } = useOnlineStore();
  const [initialRoomCode, setInitialRoomCode] = useState<string | null>(null);

  // Detect ?room=XXXXXX on initial load; auto-reconnect seamlessly if token is saved!
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('room')?.trim().toUpperCase() || null;
    if (!code) return;
    setInitialRoomCode(code);

    const savedToken = getSavedRoomToken(code);
    if (savedToken) {
      joinRoom(code, nickname, savedToken);
    }
    // Run once on initial page load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const inOnlineRoom = Boolean(room);

  return (
    <>
      {inOnlineRoom ? (
        room!.status === 'waiting' ? (
          <OnlineRoomView />
        ) : (
          <OnlineGameTableView />
        )
      ) : (
        <>
          {screen === 'lobby' && (
            <LobbyView
              availableModes={['1v1', '2v2', 'identity5']}
              availableDecks={['standard_ex', 'junzheng_161']}
              initialRoomCode={initialRoomCode}
            />
          )}
          {screen === 'table' && <GameTableView />}
          {screen === 'summary' && <SummaryView />}
        </>
      )}

      <CardDetailModal card={inspectCard} onClose={() => setInspectCard(null)} />
      <RulesModal open={showRulesModal} onClose={() => setShowRulesModal(false)} />
    </>
  );
}
