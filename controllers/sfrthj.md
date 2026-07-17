graph TD
    subgraph "Current Implementation"
        A[Express App] --> B[API Key Auth]
        A --> C[User Email Auth]
        A --> D[OAuth/Google Sheets]
        A --> E[Payment/Razorpay]
        A --> F[Job Service]
        F --> G[Google Sheets Integration]
        F --> H[Database]
    end
    
    subgraph "Required Architecture"
        AA[Express App] --> BB[JWT Auth]
        AA --> CC[Subscription Check]
        AA --> DD[Usage Limits]
        AA --> EE[Job Service]
        EE --> FF[Google Sheets]
        EE --> GG[PostgreSQL]
    end
    
    subgraph "Gap Analysis"
        GA1["✅ Google OAuth"] 
        GA2["✅ Razorpay Integration"]
        GA3["✅ API Key Auth"]
        GA4["✅ Google Sheets"]
        GA5["❌ JWT Implementation"]
        GA6["⚠️ Usage Tracking (Partial)"]
        GA7["⚠️ Subscription Enforcement"]
    end