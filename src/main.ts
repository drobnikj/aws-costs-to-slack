import { Actor } from 'apify';
import { launchPuppeteer, sleep, log } from 'crawlee';
import AWS from 'aws-sdk';
import { WebClient } from '@slack/web-api';
import moment from 'moment';
import { SERVICES_COLORS } from './services-colors.js';
import { HTML_PAGE } from './html-page.js';

const prettierResultsToKeyValue = (groups: AWS.CostExplorer.Groups) => {
    const result = {} as { [key: string]: number };
    groups.forEach((item) => {
        const costs = parseFloat(item.Metrics?.UnblendedCost?.Amount || '0');
        const service = item.Keys ? item.Keys[0] : 'Unknown';
        if (costs > 5) result[service] = Math.round(costs);
    });
    return result;
};

await Actor.main(async () => {
    log.info('Starting...');

    const explorer = new AWS.CostExplorer({
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_ACCESS_SECRET,
        region: 'us-east-1',
    });

    const yesterdayParams = {
        TimePeriod: {
            Start: moment().subtract(1, 'days').format('YYYY-MM-DD'),
            End: moment().format('YYYY-MM-DD'),
        },
        Granularity: 'DAILY',
        GroupBy: [
            {
                Type: 'DIMENSION',
                Key: 'SERVICE',
            },
        ],
        Metrics: ['UnblendedCost'],
    };

    const yesterdayStatsResponse = await explorer.getCostAndUsage(yesterdayParams).promise();
    if (!yesterdayStatsResponse?.ResultsByTime || !yesterdayStatsResponse.ResultsByTime[0].Groups) {
        throw new Error('No yesterday cost results');
    }
    const yesterdayStats = prettierResultsToKeyValue(yesterdayStatsResponse.ResultsByTime[0].Groups);

    const paramsMonth = {
        TimePeriod: {
            Start: moment().subtract(30, 'days').format('YYYY-MM-DD'),
            End: moment().format('YYYY-MM-DD'),
        },
        GroupBy: [
            {
                Type: 'DIMENSION',
                Key: 'SERVICE',
            },
        ],
        Granularity: 'DAILY',
        Metrics: ['UnblendedCost'],
    };
    const lastMonthResponse = await explorer.getCostAndUsage(paramsMonth).promise();
    if (!lastMonthResponse.ResultsByTime) {
        throw new Error('No last month results');
    }
    const datasets = {} as { [key: string]: { label: string; data: string[]; backgroundColor: string } };
    lastMonthResponse.ResultsByTime.forEach((result) => {
        if (!result.Groups) throw new Error('No last month groups');
        // Filter out tax costs
        let unknownService = 1;
        result.Groups
            // Filter out tax costs
            .filter((group) => (group.Keys && group.Keys[0] !== 'Tax'))
            .forEach((group) => {
                if (!group.Keys) throw new Error('No service name');
                let service = group.Keys[0];
                // The MongoDB service got renamed, this unifies the two services in one chart dataset
                if (service === 'MongoDB Atlas (Pay as You Go)') service='MongoDB Atlas (pay-as-you-go)';
                const costs = parseFloat(group.Metrics?.UnblendedCost?.Amount ?? '0').toFixed(2);
                if (datasets[service]) {
                    datasets[service].data.push(costs);
                    // datasets[service].backgroundColor.push(colors[i]);
                } else {
                    datasets[service] = {
                        label: service,
                        data: [costs],
                        backgroundColor: SERVICES_COLORS[service] ? SERVICES_COLORS[service] : SERVICES_COLORS[`New Service ${unknownService++}`],
                    };
                }
            });
    });

    const chart = {
        type: 'bar',
        data: {
            labels: lastMonthResponse.ResultsByTime.map((result) => result.TimePeriod?.Start),
            datasets: Object.values(datasets),
        },
        options: {
            tooltips: {
                displayColors: true,
                callbacks: {
                    mode: 'x',
                },
            },
            scales: {
                xAxes: [{
                    stacked: true,
                    gridLines: {
                        display: false,
                    },
                }],
                yAxes: [{
                    stacked: true,
                    ticks: {
                        beginAtZero: true,
                    },
                    type: 'linear',
                }],
            },
            responsive: true,
            maintainAspectRatio: false,
            legend: { position: 'bottom' },
        },
    };

    const html = HTML_PAGE.replace('{chart}', JSON.stringify(chart));
    await Actor.setValue('chart', html, {
        contentType: 'text/html',
    });

    const browser = await launchPuppeteer();
    const page = await browser.newPage();
    await page.setContent(html);
    await sleep(10000);
    const image = await page.screenshot({ fullPage: true });
    await browser.close();
    await Actor.setValue('screenshot.jpg', image, { contentType: 'image/jpeg' });

    const imageUrl = `https://api.apify.com/v2/key-value-stores/${Actor.getEnv().defaultKeyValueStoreId}/records/screenshot.jpg?disableRedirect=true`;

    const slackBotToken = process.env.SLACK_BOT_TOKEN;
    const bot = new WebClient(slackBotToken);
    await bot.chat.postMessage({
        channel: 'C0115RVFQ3B', // #eng-alerts
        // channel: 'C30TZDMKM', // test
        // @ts-ignore
        response_type: 'in_channel',
        username: 'Yesterday AWS costs',
        text: `${Object.keys(yesterdayStats).map((key) => `${key} -> *$${yesterdayStats[key]}*`).join('\n')}\n\nChart -> ${imageUrl}`,
    });

    log.info('Done!');
});
