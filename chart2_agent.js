// Biểu đồ miền (Area Chart) hiển thị chỉ số Monthly Return của CPI Việt Nam
export function getChart2AgentOption(dates, values, echarts) {
    return {
        backgroundColor: 'transparent',
        title: {
            text: 'CHỈ SỐ TỐC ĐỘ TĂNG TRƯỞNG LIÊN HOÀN',
            textStyle: { color: '#00f2fe', fontSize: 17, fontWeight: 'bold' },
            left: 'left',
            top: '0%'
        },
        legend: {
            show: true,
            textStyle: { color: '#cbd5e1', fontSize: 16 },
            right: '0%',
            top: '0%'
        },
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'line' }
        },
        grid: {
            left: '3%',
            right: '3%',
            bottom: '12%',
            top: '20%',
            containLabel: true
        },
        xAxis: {
            type: 'category',
            data: dates,
            axisLine: { lineStyle: { color: 'rgba(56, 189, 248, 0.4)' } },
            axisLabel: {
                color: '#cbd5e1',
                rotate: 45,
                fontSize: 10,
                fontFamily: "'Outfit', sans-serif",
                interval: 11 // Chỉ hiện nhãn 12 tháng một lần (mỗi năm 1 lần) để tránh trùng lặp
            }
        },
        yAxis: {
            type: 'value',
            axisLine: { lineStyle: { color: 'rgba(56, 189, 248, 0.4)' } },
            splitLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.05)' } },
            axisLabel: {
                color: '#cbd5e1',
                fontSize: 10,
                fontFamily: "'Outfit', sans-serif"
            }
        },
        series: [
            {
                name: 'Tốc Độ Tăng Trương Liên Hoàn',
                type: 'line',
                smooth: true,
                showSymbol: true,
                data: values,
                itemStyle: {
                    color: '#00f2fe'
                },
                lineStyle: {
                    width: 3,
                    color: '#00f2fe'
                },
                areaStyle: {
                    color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                        { offset: 0, color: 'rgba(0, 242, 254, 0.4)' },
                        { offset: 1, color: 'rgba(0, 242, 254, 0.01)' }
                    ])
                }
            }
        ]
    };
}