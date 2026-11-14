export async function seedPlay(user, theme) {
  const { createUser } = await import('../../src/lib/db/users.ts');
  const { hashPassword } = await import('../../src/lib/auth.ts');
  const { createCampaign, joinByInviteCode, setCampaignStatus, setCampaignScene, setHumanDm, allocateSeq } = await import('../../src/lib/db/campaigns.ts');
  const { insertQuest } = await import('../../src/lib/db/quests.ts');
  const { createSheet } = await import('../../src/lib/db/sheets.ts');
  const { createSheetSchema } = await import('../../src/lib/schemas/sheet.ts');
  const { insertCampaignMessage } = await import('../../src/lib/db/messages.ts');
  const campaign = createCampaign(user.id, { title: 'The Verdant Archive · In play', description: 'At the threshold of the living library.', theme: 'Ancient forest', maxPlayers: 4, startingLevel: 3, difficulty: 'normal', gameSettings: { appearanceTheme: theme, genre: 'high_fantasy', dmMode: 'human', aiStorySetup: false, ttsEnabled: false, ambienceEnabled: false } });
  const dm = createUser('archive_keeper', await hashPassword('ThemePreview2026!'));
  joinByInviteCode(dm.id, campaign.inviteCode);
  setHumanDm(campaign.id, dm.id);
  const heroes = [];
  for (const [index, name, race, characterClass, hp] of [[0, 'Mira Silverleaf', 'wood_elf', 'ranger', 28], [1, 'Thane of the Northern Watch', 'human', 'fighter', 34], [2, 'Elowen', 'half_elf', 'druid', 24]]) {
    const player = index === 0 ? user : createUser('preview_hero_' + index, await hashPassword('ThemePreview2026!'));
    if (index !== 0) joinByInviteCode(player.id, campaign.inviteCode);
    const sheet = createSheet(campaign.id, player.id, 3, createSheetSchema.parse({ name, race, class: characterClass, abilities: { str: 12, dex: 16, con: 14, int: 10, wis: 15, cha: 10 }, maxHp: hp, ac: 15, hitDice: { die: 'd10', total: 3, spent: 0 }, proficiencies: { saves: [], skills: ['perception'], languages: ['Common'], tools: [], armor: [], weapons: [] } }));
    heroes.push({ sheet, player });
  }
  setCampaignScene(campaign.id, 'The Elderwood · Before the living door');
  insertQuest({campaignId:campaign.id,title:'Discover why the Verdant Archive is losing its memories.',visibility:'party'});
  const message = (authorType, content, hero) => insertCampaignMessage({ campaignId: campaign.id, seq: allocateSeq(campaign.id), authorType, content, ...(hero ? { userId: hero.player.id, characterId: hero.sheet.id } : {}) });
  message('dm', 'The trail disappears beneath a ceiling of silver leaves. Ahead, the roots of an enormous oak have grown around a door, its grain twisting into the shape of a sleeping face.\n\nA lantern glows inside. The air smells of rain, cedar, and old paper.');
  message('player', 'I kneel beside the roots and study the marks carved into the bark.', heroes[0]);
  message('dm', 'The marks are names. Hundreds of them, layered over one another, each written in a different hand. As Mira brushes away the moss, a new line slowly appears:\n\n“A name freely given opens what an axe cannot.”\n\nThe face in the door opens one green eye. It waits.');
  message('player', 'I lower my shield. “We have come to help you remember.”', heroes[1]);
  message('dm', 'A silver leaf drifts into your palm. For a moment, you remember a place you have never been: a hall of living branches, every leaf carrying a story.\n\nThe latch gives a quiet click. Beyond the threshold, something is turning the pages.');
  setCampaignStatus(campaign.id, 'active');
  console.log('Story preview: /campaigns/' + campaign.id);
  return { campaign, user, dm, heroes };
}
