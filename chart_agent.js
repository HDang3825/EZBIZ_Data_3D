// Biểu đồ cột (Bar Chart) hiển thị chỉ số CPI Việt Nam
export function getChartAgentOption(dates, values, echarts) {
    return {
        backgroundColor: 'transparent',
        title: {
            text: 'BIỂU ĐỒ CHỈ SỐ CPI VIỆT NAM',
            textStyle: { color: '#38bdf8', fontSize: 17, fontWeight: 'bold' },
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
            axisPointer: { type: 'shadow' }
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
            min: 'dataMin',
            axisLine: { lineStyle: { color: 'rgba(56, 189, 248, 0.4)' } },
            splitLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.05)' } },
            axisLabel: { color: '#cbd5e1', fontSize: 10, fontFamily: "'Outfit', sans-serif" }
        },
        series: [
            {
                name: 'Chỉ số CPI (Dạng Cột)',
                type: 'bar',
                data: values,
                itemStyle: {
                    color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                        { offset: 0, color: '#38bdf8' },
                        { offset: 1, color: '#0369a1' }
                    ]),
                    borderRadius: [4, 4, 0, 0]
                },
                emphasis: {
                    itemStyle: {
                        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                            { offset: 0, color: '#00f2fe' },
                            { offset: 1, color: '#38bdf8' }
                        ])
                    }
                }
            }
        ]
    };
}