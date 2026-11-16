export async function seedValidation({ campaign, user, dm, heroes }, theme) {
  const { createCampaign, joinByInviteCode, setCampaignStatus, setHumanDm, setCampaignScene, allocateSeq, getCampaignById } = await import('../../src/lib/db/campaigns.ts');
  const { createSheet } = await import('../../src/lib/db/sheets.ts');
  const { createSheetSchema } = await import('../../src/lib/schemas/sheet.ts');
  const { insertCampaignMessage } = await import('../../src/lib/db/messages.ts');
  const { createEncounter, insertEnemy, saveEncounter } = await import('../../src/lib/db/encounters.ts');
  const { createBattleMap, insertToken } = await import('../../src/lib/db/battle-maps.ts');
  const { setInitiativeFloor } = await import('../../src/lib/dm/initiative-floor.ts');
  for (let i = 1; i <= 125; i++) {
    insertCampaignMessage({ campaignId: campaign.id, seq: allocateSeq(campaign.id), authorType: 'dm', content: `Archive entry ${String(i).padStart(3, '0')}\n\n` + Array(5).fill('The archivist turns a leaf and the room changes around you. Rain whispers against the high windows. In the margin, an unfamiliar hand has written a warning: remember the names of those who walked beside you. Mira holds the lantern while Thane searches the shelves. Beyond the doorway, Elowen hears the patient breathing of the forest.').join('\n\n') });
  }
  const fight = createCampaign(user.id, { title: 'Theme validation · Combat', description: 'A fictional encounter for interface validation.', theme: 'Ancient forest', maxPlayers: 4, startingLevel: 3, difficulty: 'normal', gameSettings: { appearanceTheme: theme, genre: 'high_fantasy', dmMode: 'human', aiStorySetup: false, ttsEnabled: false, ambienceEnabled: false } });
  joinByInviteCode(dm.id, fight.inviteCode);
  setHumanDm(fight.id, dm.id);
  const sheets = heroes.map(hero => {
    if (hero.player.id !== user.id) joinByInviteCode(hero.player.id, fight.inviteCode);
    return createSheet(fight.id, hero.player.id, 3, createSheetSchema.parse({ ...hero.sheet, equipment: [{ name: 'Longbow', qty: 1, equipped: true }, { name: 'Shortsword', qty: 1, equipped: true }, { name: 'Arrows', qty: 20 }] }));
  });
  const encounter = createEncounter(fight.id, 'Wolves at the moss bridge', 'fight');
  const wolf = insertEnemy({ encounterId: encounter.id, campaignId: fight.id, slug: 'wolf', displayName: 'Mosswood Wolf', initiative: 12, stats: { ac: 13, maxHp: 11, dexMod: 2, speed: '40 ft.', attacks: [{ name: 'Bite', attackBonus: 4, damageDice: '2d4+2', damageType: 'piercing', reach: 5 }], traits: [], resist: '', immune: '', vulnerable: '', conditionImmune: '', cr: .25, xp: 50 } });
  encounter.order = sheets.map((sheet, i) => ({ kind: 'pc', characterId: sheet.id, userId: sheet.userId, name: sheet.name, initiative: 18 - i * 4 }));
  encounter.order.push({ kind: 'enemy', enemyId: wolf.id, name: wolf.displayName, initiative: 12 });
  encounter.order.sort((a, b) => b.initiative - a.initiative);
  encounter.orderReady = true;
  encounter.turnIndex = 0;
  saveEncounter(encounter);
  setCampaignStatus(fight.id, 'active');
  setInitiativeFloor(getCampaignById(fight.id), encounter);
  setCampaignScene(fight.id, 'The moss bridge · Round one');
  const width = 16, height = 12;
  const terrain = Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => x === 0 || y === 0 || x === width - 1 || y === height - 1 ? '#' : '.').join('')).join('');
  const map = createBattleMap({ campaignId: fight.id, encounterId: encounter.id, width, height, terrain, ambient: 'bright', theme: 'field', lights: [], seed: 42 });
  sheets.forEach((sheet, i) => insertToken({ mapId: map.id, campaignId: fight.id, kind: 'pc', refId: sheet.id, name: sheet.name, x: 4, y: 4 + i }));
  insertToken({ mapId: map.id, campaignId: fight.id, kind: 'enemy', refId: wolf.id, name: wolf.displayName, x: 8, y: 5 });
  insertCampaignMessage({ campaignId: fight.id, seq: allocateSeq(fight.id), authorType: 'dm', content: 'A low growl rises from the moss bridge. The wolf steps into the path, and the forest falls silent. Mira, you have the first move.' });
  console.log('Validation fixtures ready: 125 long entries and one active battle map.');
}
