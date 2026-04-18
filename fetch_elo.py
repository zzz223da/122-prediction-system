import json
import pandas as pd
import requests
import time
from io import StringIO

CLUBELO_CSV_URL = "http://api.clubelo.com/Clubs"

def fetch_and_save_elo():
    print(f"开始从 {CLUBELO_CSV_URL} 获取最新的全球 ELO 评分...")
    max_retries = 3
    for attempt in range(max_retries):
        try:
            response = requests.get(CLUBELO_CSV_URL, timeout=30)
            response.raise_for_status()

            df = pd.read_csv(StringIO(response.text))

            # 过滤：取 To 列为 '9999-12-31' 的记录（表示当前有效）
            # 如果不存在，则按 Club 分组取 To 最大的那条
            current_df = df[df['To'] == '9999-12-31']
            if current_df.empty:
                print("未找到 To=9999-12-31 的记录，按 Club 分组取最新日期。")
                df_sorted = df.sort_values('To', ascending=False)
                current_df = df_sorted.groupby('Club').first().reset_index()

            print(f"CSV 总记录数: {len(df)}, 有效球队数: {len(current_df)}")

            # 构建 ELO 字典
            elo_dict = dict(zip(current_df['Club'], current_df['Elo']))

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
