// The DM's tool names, as a model writes one into a reply it should have
// made a call of, and the keys that carry ids. Dependency-free: tool-text.ts
// and written-calls.ts both read them, and client components import those.
// The name list holds every tool a turn can offer (turn.ts
// dmTurnToolCatalogue) and the retired names a model may still write:
// scripts/test-bare-json-salvage.mjs fails when a new tool is missing from
// it. 33 were (issue 1025), so a "[set_quest ...]" leak reached the table, an
// XML call to open_shop was dropped, and a sentence planning a set_weather
// call was read out.

export const DM_TOOL_NAME_PATTERN =
  "request_roll|group_check|check_notice|apply_hazard|set_npc|npc_reaction|social_check|roll_treasure|damage_object|travel|request_player_input|move_party|update_location|record_event|complete_beat|recall_story|search_lore|read_card|write_campaign_note|send_whisper|generate_image|apply_damage|heal|stabilize|take_rest|award_xp|party_award|modify_gold|grant_item|remove_item|handle_item|set_enemy_condition|clear_enemy_condition|set_condition|clear_condition|use_item|purchase|use_resource|use_spell_slot|learn_spell|update_sheet|start_encounter|add_enemies|add_companion|dismiss_companion|pc_attack|cast_at_enemy|cast_at_player|cast_buff|damage_enemy|enemy_attack|enemy_flees|declare_intent|aoe_damage|move_token|take_action|use_reaction|end_turn|end_encounter|summon_pet|pet_attack|damage_pet|dismiss_pet|lift|set_lifestyle|downtime|afflict|" +
  "adjust_reputation|clear_effect|dismiss_handout|dismount|end_scene|faction_note|generate_settlement|haggle|lair_action|legendary_action|legendary_resist|mount_up|npc_state|open_shop|party_stash|pass_time|play_sting|relationship_beat|relationship_end|relationship_scheme|reveal_item|romance_advance|run_prepared_encounter|scene_check|set_ambience|set_effect|set_movement|set_quest|set_weather|show_handout|show_title|start_scene|tick_objective";

// The keys of a call's arguments that carry ids. No story writes one, so a
// reply holding one beside a value is the model's bookkeeping.
export const ID_KEYS = ["characterId", "characterIds", "enemyId", "enemyIds", "targetEnemyId", "targetEnemyIds", "targetCharacterIds", "toCharacterId", "casterCharacterId", "healerId"];
