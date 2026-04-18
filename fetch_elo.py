import json
import scrapelo
import pandas as pd
import time

def fetch_and_save_elo():
    print("开始从 ClubElo.com 获取最新的全球 ELO 评分...")
    max_retries = 3
    for attempt in range(max_retries):
        try:
            # 获取所有比赛的 ELO 数据
            # 'World' 代表获取全球所有联赛的数据
            all_teams_data = scrapelo.get_competition_elo('World')

            if not all_teams_data:
                print("警告：未抓取到任何ELO数据。")
                return

            # 将抓取到的数据转换为 DataFrame
            df = pd.DataFrame(all_teams_data)
            # 以 'Club' 为索引，'ELO' 为值，构建字典
            elo_dict = df.set_index('Club')['ELO'].to_dict()

            print(f"成功获取 {len(elo_dict)} 支球队的 ELO 评分。")
            with open('club_elo.json', 'w', encoding='utf-8') as f:
                json.dump(elo_dict, f, ensure_ascii=False, indent=2)
            print("ELO 数据已更新并保存到 club_elo.json。")
            return

        except Exception as e:
            print(f"尝试 {attempt + 1} 失败: {e}")
            if attempt < max_retries - 1:
                print("等待5秒后重试...")
                time.sleep(5)
            else:
                print(f"所有 {max_retries} 次尝试均失败。")
                raise

if __name__ == "__main__":
    fetch_and_save_elo()
