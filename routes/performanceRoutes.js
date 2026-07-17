const express = require('express');
const router = express.Router();
const ProcessingService = require('../services/processingService');

// Initialize processing service
const processingService = new ProcessingService();

// GET /performance endpoint - Get detailed performance metrics
router.get('/performance', (req, res) => {
    try {
        const performanceMetrics = processingService.getPerformanceMetrics();
        const streamingStatus = processingService.getStreamingStatus();

        res.json({
            performance: performanceMetrics,
            streaming: streamingStatus,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error in /performance endpoint:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: 'An unexpected error occurred while retrieving performance metrics'
        });
    }
});

// POST /performance/gc endpoint - Force garbage collection
router.post('/performance/gc', (req, res) => {
    try {
        processingService.forceGarbageCollection();

        res.json({
            message: 'Garbage collection triggered',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error in /performance/gc endpoint:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: 'An unexpected error occurred while triggering garbage collection'
        });
    }
});

module.exports = router;

