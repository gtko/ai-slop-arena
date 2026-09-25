# Trang cửa hàng Steam: Tiếng Việt

Dán vào Steamworks (Store Page Admin > Description), ngôn ngữ "Tiếng Việt" (Vietnamese).

## Tên trò chơi

```
AI SLOP ARENA
```

## Mô tả ngắn (tối đa 300 ký tự)

```
Game đối kháng góc nhìn từ trên xuống siêu dễ thương cho tám người chơi. Chọn đấu sĩ, nấp trong bụi rậm, đập thùng lấy khối năng lượng và trụ lại cuối cùng khi khí độc khép lại. Năm đấu trường với thời tiết động và chu kỳ ngày đêm. Chơi đơn với bot hoặc online cùng bạn bè.
```

## Giới thiệu trò chơi (BBCode)

```
[img]{STEAM_APP_IMAGE}/extras/battle.gif[/img]

[h2]Người trụ lại cuối cùng sẽ chiến thắng[/h2]
Tám đấu sĩ đổ bộ xuống đấu trường. Nấp trong bụi rậm, đập thùng để lấy khối năng lượng giúp bạn mạnh hơn, và đừng bao giờ đứng yên: khí độc đang khép lại. Chỉ một người bước ra.

[h2]Năm đấu sĩ, năm lối đánh[/h2]
[list]
[*][b]Blaster[/b]: golem gốc cây dùng súng loa kèn bằng khúc gỗ bắn tỏa năm hạt gai ở tầm gần. Siêu chiêu: vụ nổ hất văng kẻ địch và phá tường.
[*][b]Gunslinger[/b]: axolotl biệt kích ngân hà với cặp súng tia bắn loạt sáu tia tầm xa. Siêu chiêu: loạt mười hai tia xuyên thẳng qua tường.
[*][b]Bomber[/b]: tiểu quỷ dung nham ném cầu lửa qua chướng ngại vật. Siêu chiêu: thiên thạch san phẳng mọi thứ xung quanh.
[*][b]Frostbite[/b]: ba mảnh băng làm chậm kẻ địch. Siêu chiêu: vụ nổ băng đóng băng mọi kẻ ở gần.
[*][b]Volt[/b]: quả cầu điện với tia sét lan sang hai kẻ địch. Siêu chiêu: cơn bão giáng sét xuống đấu trường.
[/list]

[img]{STEAM_APP_IMAGE}/extras/weather.gif[/img]

[h2]Năm đấu trường, năm kiểu thời tiết[/h2]
[list]
[*][b]Ốc Đảo[/b]: trời quang mây tạnh và những hồ nước.
[*][b]Bão Cồn Cát[/b]: bão cát quét qua các cồn cát.
[*][b]Rừng Mưa[/b]: mưa, sấm và chớp.
[*][b]Đỉnh Băng Giá[/b]: tuyết rơi và mặt băng trơn trượt.
[*][b]Đầm Sương Mù[/b]: sương mù thu hẹp tầm nhìn của bạn chỉ còn vài mét.
[/list]
Mỗi trận còn ngẫu nhiên một thời điểm trong ngày: sáng, trưa, hoàng hôn hoặc đêm. Khi trời sập tối, đèn lồng bừng sáng và một chiếc đèn đội đầu đi theo bạn, hắt những cái bóng dài về phía trước.

[h2]Chơi cùng bạn bè[/h2]
Tạo sảnh và mời bạn bè Steam, hoặc để họ vào thẳng từ danh sách bạn bè. Trận đấu chạy ngang hàng (peer-to-peer) qua Steam: không cần máy chủ, không cần mở cổng. Chỗ trống sẽ được bot lấp đầy, và bạn luôn có thể chơi đơn với bot.

[img]{STEAM_APP_IMAGE}/extras/daynight.gif[/img]

[h2]Tính năng[/h2]
[list]
[*]Trận đấu 8 người, người trụ lại cuối cùng giành chiến thắng, chơi đơn với bot hoặc online.
[*]5 đấu sĩ, mỗi người có một đòn đánh chính và một siêu chiêu.
[*]5 đấu trường với thời tiết thay đổi cách chơi: băng, sương mù, bão cát, mưa.
[*]Ánh sáng và bóng đổ thời gian thực, chu kỳ ngày đêm, bloom và che khuất môi trường (ambient occlusion).
[*]15 thành tựu Steam.
[*]Chuột và bàn phím hoặc tay cầm, có thể đổi phím.
[*]Mức đồ họa từ Thấp đến Siêu cao: chạy tốt trên cả PC cấu hình khiêm tốn.
[/list]
```

## Công bố nội dung do AI tạo (Khảo sát nội dung)

Nội dung tạo sẵn: **có**. Nội dung tạo trực tiếp: **không**.

```
Toàn bộ nội dung của trò chơi (code, hình ảnh, mô hình 3D, nhạc, hiệu ứng âm thanh) được tạo bằng AI trước khi phát hành, dưới sự chỉ đạo của một người đã kiểm tra và phê duyệt. Trò chơi không tạo ra bất kỳ nội dung AI nào trong lúc bạn chơi.
```

## Thành tựu

| Tên API | Tên | Mô tả |
| --- | --- | --- |
| `FIRST_KO` | Máu Đầu | Hạ gục một đấu sĩ. |
| `FIRST_WIN` | Người Trụ Lại Cuối Cùng | Thắng một trận. |
| `RAMPAGE` | Hủy Diệt | Hạ gục 3 đấu sĩ trong một trận. |
| `POWER_HUNGRY` | Khát Sức Mạnh | Giữ 8 khối năng lượng trong một trận. |
| `ONLINE_WIN` | Chiều Lòng Khán Giả | Thắng một trận online trước người chơi thật. |
| `SQUAD_UP` | Lập Hội | Chơi một trận online cùng bạn bè. |
| `WORLD_TOUR` | Du Hành Thế Giới | Chơi trên cả năm đấu trường. |
| `JACK_OF_ALL` | Vua Slop Đa Năng | Thắng một trận với mỗi đấu sĩ trong năm đấu sĩ. |
| `VETERAN` | Lão Làng | Chơi 25 trận. |
| `CENTURION` | Bách Nhân Trảm | Hạ gục 100 đấu sĩ. |
| `PODIUM` | Lên bục vinh quang | Kết thúc trận trong top 3. |
| `SUPER_KO` | Kết liễu siêu cấp | Hạ gục một đấu sĩ bằng siêu chiêu. |
| `NIGHT_OWL` | Cú đêm | Thắng một trận vào ban đêm. |
| `CRATE_CRUSHER` | Kẻ phá thùng | Đập vỡ 50 thùng. |
| `CHAMPION` | Nhà vô địch | Thắng 10 trận. |

## Cấu hình yêu cầu (Windows)

| | Tối thiểu | Khuyến nghị |
| --- | --- | --- |
| Hệ điều hành | Windows 10 64-bit | Windows 10/11 64-bit |
| Bộ xử lý | Lõi kép 2,5 GHz (Intel Core i3 / AMD Ryzen 3) | Lõi tứ 3 GHz (Intel Core i5 / AMD Ryzen 5) |
| Bộ nhớ | 4 GB RAM | 8 GB RAM |
| Đồ họa | GPU DirectX 11, ví dụ Intel UHD 620 (mức Thấp) | GTX 1060 / RX 580 hoặc cao hơn (mức Siêu cao) |
| Mạng | Kết nối Internet băng thông rộng (chơi online) | Kết nối Internet băng thông rộng |
| Lưu trữ | Còn trống 1 GB | Còn trống 1 GB |
| Ghi chú thêm | Chế độ chơi đơn với bot không cần kết nối mạng. | |
