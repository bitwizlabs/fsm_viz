// Module with multiple FSMs
module uart_controller (
    input  logic clk,
    input  logic rst_n,
    // TX interface
    input  logic tx_start,
    input  logic [7:0] tx_data,
    output logic tx_busy,
    output logic tx_done,
    // RX interface
    input  logic rx_data_in,
    output logic rx_valid,
    output logic [7:0] rx_data
);

// TX FSM
typedef enum logic [1:0] {
    TX_IDLE,
    TX_START,
    TX_DATA,
    TX_STOP
} tx_state_t;

tx_state_t tx_state, tx_next_state;

always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n)
        tx_state <= TX_IDLE;
    else
        tx_state <= tx_next_state;
end

always_comb begin
    tx_next_state = tx_state;
    tx_busy = 1'b0;
    tx_done = 1'b0;

    case (tx_state)
        TX_IDLE: begin
            if (tx_start) tx_next_state = TX_START;
        end
        TX_START: begin
            tx_busy = 1'b1;
            tx_next_state = TX_DATA;
        end
        TX_DATA: begin
            tx_busy = 1'b1;
            if (bit_count == 8) tx_next_state = TX_STOP;
        end
        TX_STOP: begin
            tx_done = 1'b1;
            tx_next_state = TX_IDLE;
        end
    endcase
end

// RX FSM
typedef enum logic [1:0] {
    RX_IDLE,
    RX_START,
    RX_DATA,
    RX_STOP
} rx_state_t;

rx_state_t rx_state, rx_next_state;

always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n)
        rx_state <= RX_IDLE;
    else
        rx_state <= rx_next_state;
end

always_comb begin
    rx_next_state = rx_state;
    rx_valid = 1'b0;

    case (rx_state)
        RX_IDLE: begin
            if (!rx_data_in) rx_next_state = RX_START;
        end
        RX_START: begin
            rx_next_state = RX_DATA;
        end
        RX_DATA: begin
            if (rx_bit_count == 8) rx_next_state = RX_STOP;
        end
        RX_STOP: begin
            rx_valid = 1'b1;
            rx_next_state = RX_IDLE;
        end
    endcase
end

endmodule
