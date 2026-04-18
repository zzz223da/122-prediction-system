import json
import pandas as pd
import requests
import time
from datetime import datetime

CLUBELO_CSV_URL = "http://api.clubelo.com/Clubs"

def fetch_and_save_elo():
    print(f"开始从 {CLUBELO_CSV_URL} 获取最新的全球 ELO 评分...")
    max_retries = 3
    for attempt in range(max_retries):
        try:
            # 下载 CSV 文件
            response = requests.get(CLUBELO_CSV_URL, timeout=30)
            response.raise_for_status()  # 检查请求是否成功

            # 将 CSV 文本转换为 DataFrame
            from io import StringIO
            df = pd.read_csv(StringIO(response.text))

            # 过滤：只保留当前有效的记录（'To' 日期大于等于今天）
            today_str = datetime.now().strftime('%Y-%m-%d')
            latest_records = df[df['To'] >= today_str]

            # 如果过滤后数据为空，则回退到取所有俱乐部的最后一条记录
            if latest_records.empty:
                print("警告：未找到有效期限的记录，将使用全部数据并按俱乐部去重。")
                # 按俱乐部名称排序，取每个俱乐部的最后一条
                df_sorted = df.sort_values('To', ascending=False)
                latest_records = df_sorted.groupby('Club').first().reset_index()

            # 构建俱乐部名称 -> ELO 评分的字典
            elo_dict = dict(zip(latest_records['Club'], latest_records['Elo']))

            print(f"成功获取 {len(elo_dict)} 支球队的 ELO 评分。")

            # 保存到文件
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
