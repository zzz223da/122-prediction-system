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
            csv_text = response.text

            # 调试：打印前200字符
            print("CSV 预览：", csv_text[:200])

            # 尝试解析 CSV
            try:
                df = pd.read_csv(StringIO(csv_text))
            except Exception as parse_err:
                print(f"CSV 解析失败: {parse_err}")
                raise

            print(f"CSV 列名：{list(df.columns)}")
            print(f"原始总记录数：{len(df)}")

            if len(df) == 0:
                print("⚠️ 警告：CSV 无数据，跳过更新")
                return

            # 过滤当前有效记录
            if 'To' in df.columns:
                # 将 To 列转为字符串处理
                df['To'] = df['To'].astype(str)
                current_df = df[df['To'] == '9999-12-31']
                if current_df.empty:
                    # 如果没有9999-12-31，按 Club 分组取 To 最大的记录
                    df_sorted = df.sort_values('To', ascending=False)
                    current_df = df_sorted.groupby('Club').first().reset_index()
            else:
                current_df = df

            print(f"有效球队数：{len(current_df)}")

            if len(current_df) == 0:
                print("⚠️ 警告：有效球队数为 0，跳过更新")
                return

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
                print(f"所有 {max_retries} 次尝试均失败，保留原有数据。")
                # 不抛出异常，让流程继续

if __name__ == "__main__":
    fetch_and_save_elo()
