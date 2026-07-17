/**
 * Test script for job control functionality
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:3000';

async function testJobControl() {
    console.log('🧪 Testing Job Control Functionality\n');

    try {
        // 1. Start a job
        console.log('1. Starting a test job...');
        const startResponse = await axios.post(`${BASE_URL}/search-service`, {
            city: 'pune',
            keyword: 'computer classes'
        });

        const jobId = startResponse.data.jobId;
        console.log(`✅ Job started: ${jobId}\n`);

        // 2. Wait a bit for job to start processing
        console.log('2. Waiting 5 seconds for job to start processing...');
        await new Promise(resolve => setTimeout(resolve, 5000));

        // 3. Check job status
        console.log('3. Checking job status...');
        const statusResponse = await axios.get(`${BASE_URL}/status/${jobId}`);
        console.log(`Status: ${statusResponse.data.status}`);
        console.log(`Progress: ${statusResponse.data.progress.phrasesProgress}%`);
        console.log(`Businesses found: ${statusResponse.data.progress.totalBusinesses}`);

        if (statusResponse.data.timeEstimates) {
            console.log(`Estimated time remaining: ${Math.round(statusResponse.data.timeEstimates.estimatedTimeRemaining / 60)} minutes`);
        }
        console.log('');

        // 4. Test pause
        console.log('4. Testing pause functionality...');
        const pauseResponse = await axios.post(`${BASE_URL}/jobs/${jobId}/pause`);
        console.log(`Pause result: ${pauseResponse.data.message}\n`);

        // 5. Wait and check paused status
        console.log('5. Waiting 3 seconds and checking paused status...');
        await new Promise(resolve => setTimeout(resolve, 3000));

        const pausedStatusResponse = await axios.get(`${BASE_URL}/status/${jobId}`);
        console.log(`Status after pause: ${pausedStatusResponse.data.status}\n`);

        // 6. Test resume
        console.log('6. Testing resume functionality...');
        const resumeResponse = await axios.post(`${BASE_URL}/jobs/${jobId}/resume`);
        console.log(`Resume result: ${resumeResponse.data.message}\n`);

        // 7. Wait and check resumed status
        console.log('7. Waiting 3 seconds and checking resumed status...');
        await new Promise(resolve => setTimeout(resolve, 3000));

        const resumedStatusResponse = await axios.get(`${BASE_URL}/status/${jobId}`);
        console.log(`Status after resume: ${resumedStatusResponse.data.status}`);
        console.log(`Businesses found after resume: ${resumedStatusResponse.data.progress.totalBusinesses}\n`);

        // 8. Test stop
        console.log('8. Testing stop functionality...');
        const stopResponse = await axios.post(`${BASE_URL}/jobs/${jobId}/stop`);
        console.log(`Stop result: ${stopResponse.data.message}\n`);

        // 9. Wait and check final status
        console.log('9. Waiting 5 seconds and checking final status...');
        await new Promise(resolve => setTimeout(resolve, 5000));

        try {
            const finalStatusResponse = await axios.get(`${BASE_URL}/status/${jobId}`);
            console.log(`Final status: ${finalStatusResponse.data.status}`);
            console.log(`Final businesses found: ${finalStatusResponse.data.progress.totalBusinesses}`);
            console.log(`Final businesses saved: ${finalStatusResponse.data.progress.savedBusinesses}`);
        } catch (error) {
            console.log('Job completed or removed from active jobs');
        }

        console.log('\n✅ Job control test completed successfully!');
        console.log('\n🌐 You can also test the web interface at: http://localhost:3000');

    } catch (error) {
        console.error('❌ Test failed:', error.response?.data || error.message);
    }
}

// Run the test
if (require.main === module) {
    testJobControl().catch(console.error);
}

module.exports = { testJobControl };