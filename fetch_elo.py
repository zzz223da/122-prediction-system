import json
import soccerdata as sd

def fetch_and_save_elo():
    print("开始从 ClubElo.com 获取最新的全球 ELO 评分...")
    elo = sd.ClubElo(no_cache=True)
    current_elo_df = elo.read_by_date()
    elo_dict = current_elo_df['elo'].to_dict()
    print(f"成功获取 {len(elo_dict)} 支球队的 ELO 评分。")

    with open('club_elo.json', 'w', encoding='utf-8') as f:
        json.dump(elo_dict, f, ensure_ascii=False, indent=2)

    print("ELO 数据已更新并保存到 club_elo.json。")

if __name__ == "__main__":
    fetch_and_save_elo()
