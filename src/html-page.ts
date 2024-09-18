export const HTML_PAGE = `
<html>
<head>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/2.8.0/Chart.min.css" />
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/2.8.0/Chart.min.js"></script>
<title>Aws Costs</title>
</head>
<body>
<canvas id="myChart" width="400" height="400"></canvas>
</body>
<script>
    let ctx = document.getElementById('myChart');
    let myChart = new Chart(ctx, {chart});
</script>
</html>
`;
