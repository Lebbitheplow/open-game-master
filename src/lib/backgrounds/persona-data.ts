// Suggested personality lines for the bundled backgrounds (SRD 5.1's Acolyte
// and the twelve other 2014 backgrounds ODM restates), and a general list for
// any background that suggests none of its own (the setting catalog, a
// workshop background, a pack row without tables). Written for ODM in its
// own words: a starting point the player picks from or replaces, never a
// rule. src/lib/backgrounds/persona-logic.ts chooses among them.

export type PersonaLists = { trait: string[]; ideal: string[]; bond: string[]; flaw: string[] };

export const BUNDLED_PERSONA: Record<string, PersonaLists> = {
  acolyte: {
    trait: [
      "I find a lesson from scripture in almost everything that happens.",
      "I keep my voice low and my hands folded, the way the temple taught me.",
      "I offer a blessing to strangers whether they want one or not.",
      "Quiet unsettles me, so I fill it with prayer.",
    ],
    ideal: [
      "Devotion. The rites matter, and I will keep them even on the road. (Lawful)",
      "Compassion. My faith means nothing if I walk past someone in need. (Good)",
      "Renewal. The old order of the temple must change, and I will help change it. (Chaotic)",
      "Purpose. I trust that my god has a task for me, and I mean to find it. (Any)",
    ],
    bond: [
      "I carry a relic from my temple and would die before letting it be defiled.",
      "The priest who raised me vanished, and I am searching for them.",
      "I owe my life to a stranger who shared my faith, and I mean to repay it.",
      "A rival temple slandered mine, and I will clear its name.",
    ],
    flaw: [
      "I judge those who do not share my faith more harshly than I should.",
      "I trust anyone who wears the holy symbol of my god.",
      "I hide a doubt about my god that I have never spoken aloud.",
      "Once I decide something is sacred, I will not bend on it.",
    ],
  },
  charlatan: {
    trait: [
      "I have a new name and a new story for every town.",
      "I flatter people out of habit, even when I want nothing from them.",
      "I always know where the nearest exit is.",
      "I laugh at my own jokes before anyone else can.",
    ],
    ideal: [
      "Freedom. Nobody gets to tell me who I am. (Chaotic)",
      "Fairness. I only fleece people who can afford it, or who deserve it. (Good)",
      "Comfort. A soft bed and a full purse are worth a few lies. (Neutral)",
      "Craft. A con done well is a work of art. (Any)",
    ],
    bond: [
      "I once swindled the wrong person, and they are still looking for me.",
      "My old partner went to prison in my place. I owe them everything.",
      "I send part of every take to a family who thinks I am a merchant.",
      "There is one mark I could never fool, and I will try again.",
    ],
    flaw: [
      "I cannot pass up a gullible target, even when it puts us all at risk.",
      "I lie when the truth would serve me better.",
      "Coin in front of me is coin I already think of as mine.",
      "I panic when someone sees through one of my stories.",
    ],
  },
  criminal: {
    trait: [
      "I size up every room for what is worth taking.",
      "I keep my back to the wall and my voice down.",
      "I talk my way around a problem before I reach for a knife.",
      "I never forget a face, or a debt.",
    ],
    ideal: [
      "Loyalty. I do not sell out my crew, ever. (Lawful)",
      "Freedom. Laws are chains made by rich people. (Chaotic)",
      "Redemption. I want to be more than what I have done. (Good)",
      "Greed. I will do whatever it takes to get rich. (Evil)",
    ],
    bond: [
      "My old gang is in trouble, and I am the only one who got out.",
      "I am saving every coin to buy a better life for someone I love.",
      "A guard captain ruined my life, and one day I will return the favor.",
      "I stole something I should not have, and its owner wants it back.",
    ],
    flaw: [
      "When I see something valuable, I start planning how to take it.",
      "I would rather run than fight fair.",
      "I assume everyone is working an angle, because I always am.",
      "An innocent died because of a job I did, and I hide it.",
    ],
  },
  entertainer: {
    trait: [
      "I turn every meal into an audience.",
      "I know a song for every occasion, and some for no occasion at all.",
      "I change my voice to fit whoever I am talking to.",
      "Applause is the best thing in the world, and silence the worst.",
    ],
    ideal: [
      "Joy. The world is grim enough; people need something to smile about. (Good)",
      "Expression. Art should say what others are afraid to. (Chaotic)",
      "Fame. I will be remembered long after I am gone. (Any)",
      "Tradition. The old songs keep the old truths alive. (Lawful)",
    ],
    bond: [
      "My first instrument belonged to my teacher, and I would never part with it.",
      "A rival performer stole my best work, and I want it back.",
      "I perform to honor a troupe that was lost on the road.",
      "Someone in my audience once saved my life. I still look for their face.",
    ],
    flaw: [
      "I cannot resist a dramatic gesture, however badly timed.",
      "I need to be the center of attention, and I sulk when I am not.",
      "I spend money as fast as I earn it.",
      "I fall in love with someone new in every town.",
    ],
  },
  folk_hero: {
    trait: [
      "I judge people by what they do, not who their parents were.",
      "When someone is in trouble, I step in before I think.",
      "I speak plainly and expect others to do the same.",
      "I still work with my hands to keep them honest.",
    ],
    ideal: [
      "Justice. The powerful should answer for what they do. (Good)",
      "Independence. Common folk can rule themselves. (Chaotic)",
      "Duty. My village trusted me, and I will not let them down. (Lawful)",
      "Destiny. I was meant for something more than the fields. (Any)",
    ],
    bond: [
      "My home village still tells the story of what I did, and I mean to deserve it.",
      "A lord took everything from my family, and I will see it returned.",
      "I protect the people who cannot protect themselves.",
      "I carry a token from the first person I saved.",
    ],
    flaw: [
      "I am convinced I can win any fight, however bad the odds.",
      "I do not trust anyone with fine clothes and soft hands.",
      "My stubborn pride keeps me from asking for help.",
      "I believe my own legend a little too much.",
    ],
  },
  guild_artisan: {
    trait: [
      "I judge everything by how well it was made.",
      "I always have a price in mind, even for a kindness.",
      "I talk shop with anyone who stands still long enough.",
      "I keep careful records of every deal I make.",
    ],
    ideal: [
      "Community. A guild protects its own, and so do I. (Lawful)",
      "Excellence. Good enough never is. (Any)",
      "Generosity. My skill is a gift I should share. (Good)",
      "Ambition. One day I will run the guild. (Evil)",
    ],
    bond: [
      "The workshop where I learned my craft means everything to me.",
      "I made something for a patron who never paid, and I will collect.",
      "My guild sponsored my travels, and I owe them a return.",
      "I am searching for a lost technique my master spoke of.",
    ],
    flaw: [
      "I will do almost anything to get my hands on something rare.",
      "I look down on anyone who works carelessly.",
      "I cannot let an insult to my work pass.",
      "I am sure there is a better deal around the next corner.",
    ],
  },
  hermit: {
    trait: [
      "I am comfortable with long silences, and other people are not.",
      "I talk to animals as if they were old friends.",
      "I take my time before I answer anything.",
      "Crowds and noise wear on me quickly.",
    ],
    ideal: [
      "Knowledge. The truth I found in solitude must be understood. (Neutral)",
      "Peace. Most quarrels are not worth having. (Good)",
      "Self-reliance. I answer to no one but my own conscience. (Chaotic)",
      "Discipline. Mind and body must be kept in order. (Lawful)",
    ],
    bond: [
      "The discovery I made in isolation must reach the right ears.",
      "I left my retreat to find the one person I still care about.",
      "I keep a journal of everything I have seen since I came back to the world.",
      "Something terrible drove me into hiding, and I mean to face it.",
    ],
    flaw: [
      "I forget the manners other people expect.",
      "I hold secrets so tightly that I hurt those around me.",
      "I am sure my insight puts me above ordinary concerns.",
      "I let my curiosity lead me into danger.",
    ],
  },
  noble: {
    trait: [
      "My manners are flawless, even in a muddy tavern.",
      "I expect to be listened to, and I usually am.",
      "I am quick to praise good service and slow to forgive bad.",
      "I hide my worries behind a polite smile.",
    ],
    ideal: [
      "Responsibility. Privilege means duty to those below me. (Lawful)",
      "Nobility. True worth is shown by deeds, not by birth. (Good)",
      "Power. Influence is the only thing that lasts. (Evil)",
      "Family. The honor of my house comes first. (Any)",
    ],
    bond: [
      "My house has fallen on hard times, and I will restore it.",
      "I am promised in marriage to someone I have never met.",
      "A servant raised me more than my parents did, and I would do anything for them.",
      "A rival house wronged mine, and I will see it humbled.",
    ],
    flaw: [
      "I secretly think I am better than everyone else.",
      "I cannot stand to be seen doing menial work.",
      "I hide a scandal that could ruin my family.",
      "I spend coin as if it will never run out.",
    ],
  },
  outlander: {
    trait: [
      "I am more at home under the stars than under a roof.",
      "I measure people by how they treat the land.",
      "I would rather track a beast than make small talk.",
      "I eat whatever is put in front of me and ask what else there is.",
    ],
    ideal: [
      "Change. Life is a river, and I go where it carries me. (Chaotic)",
      "Harmony. Take only what the wild can spare. (Good)",
      "Strength. The weak are protected by the strong, or they perish. (Evil)",
      "Kin. My people's ways must survive. (Lawful)",
    ],
    bond: [
      "My tribe was scattered, and I will bring them back together.",
      "I carry the bones of an ancestor to their proper resting place.",
      "A beast I raised was taken from me, and I will find it.",
      "I swore to guard a sacred place in the wild.",
    ],
    flaw: [
      "I do not trust towns, or the people who live in them.",
      "I solve problems with force when patience would do.",
      "I drink too deeply when the hunt is over.",
      "I will not back down from a challenge, however foolish.",
    ],
  },
  sage: {
    trait: [
      "I quote books that nobody else has read.",
      "I lose track of time whenever I find something new to study.",
      "I correct other people's facts, kindly but always.",
      "I take notes on everything, including conversations.",
    ],
    ideal: [
      "Knowledge. Understanding is the path to everything worth having. (Neutral)",
      "Sharing. Knowledge locked away does no good. (Good)",
      "Order. The world makes sense once it is properly catalogued. (Lawful)",
      "Mastery. Knowing more than others is power over them. (Evil)",
    ],
    bond: [
      "I am searching for a book that may not exist.",
      "My old library burned, and I will learn what started the fire.",
      "My mentor left a question unanswered, and I will answer it.",
      "I guard a secret that scholars would kill for.",
    ],
    flaw: [
      "I overlook obvious answers while I chase clever ones.",
      "I am easily distracted by the promise of new knowledge.",
      "I talk down to people who know less than I do.",
      "I would risk a great deal to read a forbidden text.",
    ],
  },
  sailor: {
    trait: [
      "I have a sea story for every situation, and most are true.",
      "I work hard and play harder.",
      "Storms do not frighten me; still water does.",
      "I curse like a deckhand when I am angry, and often when I am not.",
    ],
    ideal: [
      "Crew. We live or drown together. (Lawful)",
      "Freedom. The open sea answers to no king. (Chaotic)",
      "Mastery. I will captain my own ship one day. (Any)",
      "Fairness. Every hand gets an honest share. (Good)",
    ],
    bond: [
      "My first ship sank, and I want to know why.",
      "I left someone waiting in a port, and I mean to go back.",
      "A captain once spared me when they should not have, and I owe them.",
      "I am hunting the pirates who took my shipmates.",
    ],
    flaw: [
      "I follow orders only when I like who gives them.",
      "I gamble away my wages faster than I earn them.",
      "I cannot resist a bet, or a dare.",
      "I believe every sailor's superstition and act on them.",
    ],
  },
  soldier: {
    trait: [
      "I keep my gear clean and ready, even when we are resting.",
      "I am polite to officers and blunt with everyone else.",
      "I can sleep anywhere and wake at the smallest sound.",
      "I tell war stories that make the battles sound smaller than they were.",
    ],
    ideal: [
      "Duty. Orders exist for a reason. (Lawful)",
      "Protection. I fight so others do not have to. (Good)",
      "Glory. A soldier's name should be remembered. (Any)",
      "Might. The strong decide, and I intend to be strong. (Evil)",
    ],
    bond: [
      "I will never forget the comrade who died beside me.",
      "My old unit still counts on me, wherever I am.",
      "I carry the banner of a company that no longer exists.",
      "An officer sent us into a slaughter, and I will see them answer for it.",
    ],
    flaw: [
      "Nightmares of a battle long past still keep me up.",
      "I obey anyone who sounds like they are in command.",
      "I cannot admit when I am beaten.",
      "I have little patience for those who have never seen a fight.",
    ],
  },
  urchin: {
    trait: [
      "I keep a little food hidden, just in case.",
      "I fidget when I have to sit still.",
      "I know the shortcuts through every alley in town.",
      "I trust kids and animals more than grown folk.",
    ],
    ideal: [
      "Respect. Everyone deserves dignity, especially the poor. (Good)",
      "Community. The street looks after its own. (Lawful)",
      "Change. The city's rich should know what hunger feels like. (Chaotic)",
      "Survival. I do what I must to see tomorrow. (Neutral)",
    ],
    bond: [
      "I look after the street kids who are still where I was.",
      "A kind stranger fed me once, and I want to find them.",
      "I am saving to buy a home of my own.",
      "A gang boss still thinks I owe them, and maybe I do.",
    ],
    flaw: [
      "I take things that are not mine without thinking.",
      "I run from a fight I cannot win, and leave others behind.",
      "I do not trust anyone who offers help for free.",
      "I would sell out a stranger to keep my friends fed.",
    ],
  },
};

// For any background without lists of its own.
export const GENERAL_PERSONA: PersonaLists = {
  trait: [
    "I am curious about everything, and I ask too many questions.",
    "I keep calm when everyone else is shouting.",
    "I make friends quickly and remember every one of them.",
    "I speak little, but I mean every word.",
    "I always have a joke ready, especially when things look grim.",
    "I am fiercely organized, down to how I pack my bag.",
    "I tell the truth even when it costs me.",
    "I hum or whistle when I think nobody is listening.",
  ],
  ideal: [
    "Kindness. A little help changes more than people think. (Good)",
    "Honor. My word is the one thing nobody can take from me. (Lawful)",
    "Freedom. Everyone should choose their own road. (Chaotic)",
    "Balance. Extremes break things; the middle path holds. (Neutral)",
    "Ambition. I will make something of myself, whatever it takes. (Any)",
    "Knowledge. Understanding the world is worth any risk. (Neutral)",
  ],
  bond: [
    "My family is everything to me, even the ones I fight with.",
    "I owe a debt to someone who saved my life.",
    "I am searching for someone I lost long ago.",
    "My hometown is in danger, and I left to find a way to save it.",
    "I made a promise to a dying friend, and I will keep it.",
    "An enemy from my past is hunting me.",
  ],
  flaw: [
    "I am quick to anger and slow to forgive.",
    "I cannot keep a secret to save my life.",
    "I trust too easily, and I have paid for it before.",
    "I am too proud to admit when I am wrong.",
    "I take foolish risks to prove that I am brave.",
    "Greed gets the better of me when there is treasure in sight.",
  ],
};
