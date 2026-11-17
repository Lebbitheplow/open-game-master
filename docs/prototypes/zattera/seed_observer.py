# PROTOTYPE: the "observer" Zattera. The cloned campaign's cast, with
# everything in common: the same things on every body, the food and water
# lying on the raft for whoever takes them, and no line of anyone's past that
# gives them a weapon, a key or a hoard. Brakk only watches.
# Usage: python3 seed_observer.py <new_campaign> <source_campaign> <brakk_sheet> <db_path>
import json, sqlite3, sys, uuid, datetime, importlib.util, os

spec = importlib.util.spec_from_file_location("seed", os.path.join(os.path.dirname(__file__), "seed.py"))
seed = importlib.util.module_from_spec(spec); spec.loader.exec_module(seed)

PLACE = "La zattera della Clemenza"
SAME = ["una coperta lacera", "una ciotola di legno"]
GROUND = [("Galletta", 40), ("Pesce essiccato", 12), ("un barile d'acqua dolce", 1)]
OWNED = ("sacco", "gallett", "chiave", "balestra", "quadrell", "fiala", "cicuta", "anell", "bussola", "pugnale", "coltello", "rum", "lenza", "barile")
AMBITION = {
    "Ottone Kranz": "Diventare il capo della zattera e farne cacciare chi la 'contamina', a cominciare dallo straniero Mairon.",
    "Volodar": "Sopravvivere e conoscere i segreti di tutti, finché ogni naufrago ha bisogno di lui.",
    "Gruoch": "Fare di un uomo forte il re della zattera e regnare attraverso di lui; poi tornare a terra regina, non condannata.",
    "Mairon": "Che ogni naufrago gli giuri fedeltà prima di toccare terra.",
}

def main(new, source, brakk, path):
    db = sqlite3.connect(path)
    now = datetime.datetime.now(datetime.UTC).replace(tzinfo=None).isoformat(timespec="milliseconds") + "Z"
    by_name = {c["name"]: c for c in seed.CAST}
    for nid, name in db.execute("select id, name from npcs where campaign_id=?", (new,)).fetchall():
        c = by_name[name]
        state = dict(custody="free", heldBy="", restraint="none", condition="up", withParty=True, disarmed=False, carries=SAME)
        db.execute("update npcs set cast_sheet_id='', location=?, state_json=?, goals_json=?, updated_at=? where id=?",
                   (PLACE, json.dumps(state, ensure_ascii=False), json.dumps({"ambition": AMBITION.get(name, c["ambition"])}, ensure_ascii=False), now, nid))
        db.execute("delete from npc_memories where npc_id=?", (nid,))
        kept = [line for line in c["past"] if not any(word in line.lower() for word in OWNED)]
        kept.append("Sulla zattera niente è di nessuno: le gallette, il pesce secco e il barile d'acqua stanno sulle assi, a portata di chiunque. Addosso ho solo una coperta lacera e una ciotola di legno, come tutti gli altri. Nessuno ha armi.")
        for line in kept:
            db.execute("insert into npc_memories (id, campaign_id, npc_id, kind, source_kind, source_name, content, learned_at, turn_id, created_at) values (?,?,?,?,?,?,?,?,?,?)",
                       (str(uuid.uuid4()), new, nid, "knowledge", "background", "", line, 0, "", now))
        print(name, len(kept), "memories")
    # Brakk, as he was, with the same two things.
    cols = [r[1] for r in db.execute("pragma table_info(character_sheets)")]
    row = dict(zip(cols, db.execute("select * from character_sheets where id=?", (brakk,)).fetchone()))
    row.update(id=str(uuid.uuid4()), campaign_id=new, equipment_json=json.dumps([{"name": t, "qty": 1} for t in SAME], ensure_ascii=False), created_at=now, updated_at=now)
    db.execute(f"insert into character_sheets ({','.join(cols)}) values ({','.join('?' * len(cols))})", [row[c] for c in cols])
    print("Brakk", row["id"])
    db.execute("update locations set is_current = case when name=? then 1 else 0 end where campaign_id=?", (PLACE, new))
    db.execute("delete from locations where campaign_id=? and name!=?", (new, PLACE))
    for name, qty in GROUND:
        db.execute("insert into dropped_items (id, campaign_id, map_id, x, y, place, item_json, dropped_by, held_by_enemy, created_at) values (?,?,?,?,?,?,?,?,?,?)",
                   (str(uuid.uuid4()), new, None, None, None, PLACE, json.dumps({"name": name, "qty": qty}, ensure_ascii=False), "", None, now))
    db.commit()

if __name__ == "__main__":
    main(*sys.argv[1:5])
