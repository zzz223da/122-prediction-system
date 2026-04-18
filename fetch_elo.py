# fetch_elo.py
import json
import soccerdata as sd

def fetch_and_save_elo():
    print("开始从ClubElo.com获取最新的全球ELO评分...")
    
    # 初始化ClubElo数据源
    # no_cache=True 确保每次都获取最新数据
    elo = sd.ClubElo(no_cache=True)
    
    # 获取当前日期的所有球队ELO评分
    # read_by_date() 返回一个包含所有球队最新评分的DataFrame
    current_elo_df = elo.read_by_date()
    
    # 将DataFrame转换为字典格式，方便保存为JSON
    # 索引是球队名，值为ELO评分
    elo_dict = current_elo_df['elo'].to_dict()
    
    print(f"成功获取 {len(elo_dict)} 支球队的ELO评分。")
    
    # 将数据保存到 club_elo.json 文件中
    # 确保编码为UTF-8，正确处理各种字符
    with open('club_elo.json', 'w', encoding='utf-8') as f:
        json.dump(elo_dict, f, ensure_ascii=False, indent=2)
    
    print("ELO数据已更新并保存到 club_elo.json。")

if __name__ == "__main__":
    fetch_and_save_elo()